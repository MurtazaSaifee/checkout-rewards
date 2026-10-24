import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../../db/transaction.js';
import { type ShortLine, CartEmptyError, InsufficientStockError } from '../carts/cart.errors.js';
import {
  type CartLineRow,
  lockEditableCart,
  markCartCheckedOut,
  selectCartLines,
} from '../carts/carts.repository.js';
import { priceOrder } from '../pricing/pricing.js';
import { findProduct, takeStock } from '../products/products.repository.js';
import { type OrderView, loadOrderView } from '../orders/orders.repository.js';
import { type PaymentGateway } from '../payments/payment-gateway.js';
import { CouponAlreadyRedeemedError } from '../coupons/coupon.errors.js';
import { markCouponRedeemed } from '../coupons/coupons.repository.js';
import { lockRedeemableCoupon } from '../coupons/coupons.service.js';
import { type CheckoutOptions } from './checkout.options.js';
import { IdempotencyKeyReusedError, PaymentDeclinedError } from './checkout.errors.js';
import {
  claimIdempotencyKey,
  storeIdempotentResponse,
} from './idempotency.repository.js';
import { insertOrder, insertOrderLines, takeNextOrderNumber } from './checkout.repository.js';
import { requestFingerprint } from './request-fingerprint.js';

export interface CheckoutInput {
  cartId: string;
  customerId: string;
  idempotencyKey: string;
  options: CheckoutOptions;
}

/** What a checkout answers. A replay carries the response of the attempt that placed the order. */
export interface CheckoutOutcome {
  /** True when an earlier attempt under the same key placed the order and this answer repeats it. */
  replayed: boolean;
  status: number;
  order: OrderView;
}

const PLACED_STATUS = 201;

/** Postgres's unique violation, and the name of the constraint that lets each coupon appear on one order only. */
const UNIQUE_VIOLATION = '23505';
const ORDER_COUPON_CONSTRAINT = 'orders_coupon_code_key';

/** True only for the one-order-per-coupon constraint, so any other failure still surfaces as an error. */
function isCouponAlreadyOrdered(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    error.code === UNIQUE_VIOLATION &&
    'constraint' in error &&
    error.constraint === ORDER_COUPON_CONSTRAINT
  );
}

/**
 * Checks out a cart. The whole checkout is one transaction, so it either places
 * the order in full or changes nothing. The steps run in this order, and every
 * step that a later change adds goes between the ones around it.
 */
export async function checkOut(
  db: Pool,
  payments: PaymentGateway,
  input: CheckoutInput,
): Promise<CheckoutOutcome> {
  return withTransaction(db, async (client) => {
    // Step 1: claim the idempotency key before the cart is locked. A retry of a
    // checkout that already placed its order is answered from the stored response
    // here, so it never reaches the cart, which by now reads as checked out. A
    // concurrent attempt with the same key waits on this claim until the first
    // attempt commits or rolls back.
    const fingerprint = requestFingerprint({ cartId: input.cartId, options: input.options });
    const claim = await claimIdempotencyKey(client, input.customerId, input.idempotencyKey, fingerprint);
    if (!claim.claimed) {
      if (claim.fingerprint !== fingerprint) {
        throw new IdempotencyKeyReusedError();
      }
      return {
        replayed: true,
        status: claim.response.status,
        order: JSON.parse(claim.response.bodyJson) as OrderView,
      };
    }

    // Step 2: lock the cart with the lock every cart edit takes. A missing or
    // foreign cart and a checked-out cart are rejected here. An edit that raced
    // us either committed before this read, so it is in the order, or waits and
    // is then rejected as checked out.
    const cart = await lockEditableCart(client, input.cartId, input.customerId);
    const lines = await selectCartLines(client, cart.id);
    if (lines.length === 0) {
      throw new CartEmptyError();
    }

    // Step 3: the lines carry current prices, read in this transaction, and the
    // order keeps exactly what was read. The amounts are worked out once the
    // coupon is known, at step 5.

    // Step 4: take stock, one conditional update per line, in product order. The
    // lines come back ordered by product, so concurrent checkouts lock products
    // in the same sequence and cannot deadlock on each other. Every line is
    // tried even after one is short, so the error lists them all. Nothing is
    // kept: the throw below rolls back the lines that were taken.
    const shortLines: ShortLine[] = [];
    for (const line of lines) {
      const taken = await takeStock(client, line.productId, line.quantity);
      if (!taken) {
        shortLines.push(await describeShortLine(client, line));
      }
    }
    if (shortLines.length > 0) {
      throw new InsufficientStockError(shortLines);
    }

    // Step 5: redeem the coupon, if one was named. Its row is locked until this
    // transaction ends, so a concurrent checkout that names it waits here and then
    // sees the redemption. Nothing is recorded yet. The redemption is written at
    // step 8, with the order, so a checkout that fails before then leaves the
    // coupon unredeemed. The discount is taken once, on the subtotal.
    const coupon =
      input.options.couponCode === undefined
        ? undefined
        : await lockRedeemableCoupon(client, input.options.couponCode, input.customerId);
    const amounts = priceOrder(lines, coupon?.percentOff);

    // Step 6: charge the total through the payment gateway, inside the transaction.
    // A decline throws, so the stock taken above, the coupon and the claimed key
    // roll back with it. Nothing has been placed yet, so a retry with another token
    // starts clean. This holds only because the gateway is in-process: a real
    // provider's charge cannot be undone by a rollback.
    const charge = await payments.charge({
      amountCents: amounts.totalCents,
      paymentToken: input.options.paymentToken,
    });
    if (charge === 'declined') {
      throw new PaymentDeclinedError();
    }

    // Step 7: take the order number. This is the last write before the order
    // insert, so a checkout that fails above never takes a number.
    const orderNumber = await takeNextOrderNumber(client);

    // Step 8: record the order, its lines, the coupon's redemption and the cart's
    // checkout. The unique constraint on the order's coupon code refuses a second
    // order for the coupon. The row lock above normally stops that from happening,
    // so the constraint is the backstop that keeps the rule true without the lock.
    let orderId: string;
    try {
      orderId = await insertOrder(client, {
        orderNumber,
        customerId: input.customerId,
        cartId: cart.id,
        subtotalCents: amounts.subtotalCents,
        coupon: coupon === undefined ? null : { code: coupon.code, percentOff: coupon.percentOff },
        discountCents: amounts.discountCents,
        totalCents: amounts.totalCents,
      });
    } catch (error) {
      if (coupon !== undefined && isCouponAlreadyOrdered(error)) {
        throw new CouponAlreadyRedeemedError();
      }
      throw error;
    }
    if (coupon !== undefined) {
      await markCouponRedeemed(client, coupon.code, orderId);
    }
    await insertOrderLines(client, orderId, lines);
    await markCartCheckedOut(client, cart.id);

    // Step 9: store the response against the key, then commit. The stored text is
    // the exact body the client receives, so a replay is byte-for-byte the same.
    const order = await loadOrderView(client, orderId);
    await storeIdempotentResponse(client, input.customerId, input.idempotencyKey, {
      status: PLACED_STATUS,
      bodyJson: JSON.stringify(order),
    });
    return { replayed: false, status: PLACED_STATUS, order };
  });
}

/** The quantities of a line that could not be taken, with the stock available to it now. */
async function describeShortLine(client: PoolClient, line: CartLineRow): Promise<ShortLine> {
  const product = await findProduct(client, line.productId);
  if (product === undefined) {
    throw new Error(`product ${line.productId} vanished during checkout`);
  }
  return { productId: line.productId, requested: line.quantity, available: product.stock };
}
