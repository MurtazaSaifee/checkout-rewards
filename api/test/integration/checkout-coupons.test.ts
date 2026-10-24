import type { Express } from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type ChargeOutcome,
  type ChargeRequest,
  type PaymentGateway,
} from '../../src/modules/payments/payment-gateway.js';
import { useTestDatabase } from '../helpers/test-database.js';
import { createCart, setLine, viewCart } from '../helpers/cart-api.js';
import { checkOut, listMyOrders, placeOrder } from '../helpers/checkout-api.js';
import { generateCoupon, listAllCoupons, listMyCoupons } from '../helpers/coupon-api.js';
import type {
  AdminCoupon,
  Cart,
  Coupon,
  GeneratedCoupon,
  Order,
  Problem,
  ProductListing,
} from '../helpers/api-types.js';

/** Every order placed to reach a milestone buys one mug, which always has stock. */
const MUG: ReadonlyArray<readonly [string, number]> = [['ceramic-mug', 1]];

/** A code of the right shape that no coupon is ever issued with. */
const UNISSUED_CODE = 'AAAAAAAAAA';

/** Current stock of every product, keyed by product id, read through the public product listing. */
async function productStock(app: Express): Promise<Record<string, number>> {
  const { products } = (await request(app).get('/api/products')).body as ProductListing;
  return Object.fromEntries(products.map((product) => [product.id, product.stock]));
}

/** How many orders this test file has placed so far, so each milestone can be reached on purpose. */
interface OrderCount {
  placed: number;
}

/**
 * Issues the coupon for the next milestone to the customer, the way the store does it: the
 * customer places the milestone order, and an administrator generates the coupon. With n = 2
 * an even-numbered order reaches a milestone, so a filler customer places the odd one first
 * whenever the next order number would be odd. Used only in a beforeAll, before any test
 * places an order of its own, so the count stays exact.
 */
async function earnCoupon(app: Express, orders: OrderCount, customerId: string): Promise<Coupon> {
  if (orders.placed % 2 === 0) {
    await placeOrder(app, `filler-${orders.placed + 1}`, MUG);
    orders.placed += 1;
  }
  await placeOrder(app, customerId, MUG);
  orders.placed += 1;

  const response = await generateCoupon(app);
  expect(response.status).toBe(201);
  const body = response.body as GeneratedCoupon;
  expect(body.customerId).toBe(customerId);
  return body.coupon;
}

/** Creates a cart for the customer and sets each line in it, returning the cart's identifier. */
async function cartWith(
  app: Express,
  customerId: string,
  lines: ReadonlyArray<readonly [string, number]>,
): Promise<string> {
  const cartId = await createCart(app, customerId);
  for (const [productId, quantity] of lines) {
    expect((await setLine(app, customerId, cartId, productId, quantity)).status).toBe(200);
  }
  return cartId;
}

/** The customer's view of one coupon, found by its code. */
async function couponOf(app: Express, customerId: string, code: string): Promise<Coupon> {
  const { coupons } = (await listMyCoupons(app, customerId)).body as { coupons: Coupon[] };
  const coupon = coupons.find((candidate) => candidate.code === code);
  if (coupon === undefined) {
    throw new Error(`${customerId} holds no coupon ${code}`);
  }
  return coupon;
}

/** Records every charge the checkout makes, and approves each one. */
class RecordingGateway implements PaymentGateway {
  readonly charges: ChargeRequest[] = [];

  charge(request: ChargeRequest): Promise<ChargeOutcome> {
    this.charges.push(request);
    return Promise.resolve('approved');
  }
}

describe('redeeming a coupon at checkout', () => {
  const database = useTestDatabase({ coupons: { everyNOrders: 2 } });
  const orders: OrderCount = { placed: 0 };
  const earned: Record<string, Coupon> = {};

  beforeAll(async () => {
    earned.alice = await earnCoupon(database.app, orders, 'alice');
    earned.carol = await earnCoupon(database.app, orders, 'carol');
  });

  it('takes the coupon percentage off the subtotal, rounded down once, and records the coupon on the order', async () => {
    const coupon = earned.alice!;
    // The subtotal is 8,999 + 1,200 = 10,199 cents. Ten per cent is 1,019.9 cents, which rounds down to 1,019.
    const cartId = await cartWith(database.app, 'alice', [
      ['limited-hoodie', 1],
      ['ceramic-mug', 1],
    ]);

    const response = await checkOut(database.app, 'alice', cartId, undefined, undefined, coupon.code);

    expect(response.status).toBe(201);
    const order = response.body as Order;
    expect(order).toMatchObject({
      couponCode: coupon.code,
      couponPercentOff: 10,
      subtotalCents: 10199,
      discountCents: 1019,
      totalCents: 9180,
    });
    expect(await couponOf(database.app, 'alice', coupon.code)).toMatchObject({ redeemed: true });
    const { coupons } = (await listAllCoupons(database.app)).body as { coupons: AdminCoupon[] };
    expect(coupons.find((candidate) => candidate.code === coupon.code)).toMatchObject({
      redeemedByOrderId: order.id,
    });
  });

  it('answers an already-redeemed coupon with 422 COUPON_ALREADY_REDEEMED, and places no second order', async () => {
    const coupon = earned.carol!;
    const first = await cartWith(database.app, 'carol', [['enamel-bottle', 1]]);
    expect((await checkOut(database.app, 'carol', first, undefined, undefined, coupon.code)).status).toBe(201);
    const ordersBefore = ((await listMyOrders(database.app, 'carol')).body as { orders: Order[] }).orders.length;

    const second = await cartWith(database.app, 'carol', [['enamel-bottle', 1]]);
    const response = await checkOut(database.app, 'carol', second, undefined, undefined, coupon.code);
    const cart = (await viewCart(database.app, 'carol', second)).body as Cart;

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ status: 422, code: 'COUPON_ALREADY_REDEEMED' });
    expect(cart.status).toBe('open');
    expect(((await listMyOrders(database.app, 'carol')).body as { orders: Order[] }).orders).toHaveLength(ordersBefore);
  });
});

describe('two carts redeeming one coupon at the same time', () => {
  const database = useTestDatabase({ coupons: { everyNOrders: 2 } });
  const orders: OrderCount = { placed: 0 };
  const rounds = 10;
  const earned: Coupon[] = [];

  beforeAll(async () => {
    for (let round = 0; round < rounds; round++) {
      earned.push(await earnCoupon(database.app, orders, `racer-${round}`));
    }
  });

  it('lets exactly one checkout redeem the coupon and answers the other with 422 COUPON_ALREADY_REDEEMED, in every round', async () => {
    for (let round = 0; round < rounds; round++) {
      const customerId = `racer-${round}`;
      const coupon = earned[round]!;
      // The two carts take different products, so the checkouts never queue on one product's
      // stock row. Both then reach the coupon together, and only the coupon decides the race.
      const carts = [
        await cartWith(database.app, customerId, [['notebook-set', 1]]),
        await cartWith(database.app, customerId, [['enamel-bottle', 1]]),
      ] as const;
      const before = await productStock(database.app);

      const responses = await Promise.all(
        carts.map((cartId) => checkOut(database.app, customerId, cartId, undefined, undefined, coupon.code)),
      );

      const placed = responses.filter((response) => response.status === 201);
      const refused = responses.filter((response) => response.status === 422);
      expect(placed, `round ${round}`).toHaveLength(1);
      expect(refused, `round ${round}`).toHaveLength(1);
      expect(refused[0]!.body).toMatchObject({ status: 422, code: 'COUPON_ALREADY_REDEEMED' });
      expect((placed[0]!.body as Order).couponCode).toBe(coupon.code);

      // Only the winner's line took stock, and the refused cart is still open.
      const loserCart = responses[0]!.status === 201 ? carts[1] : carts[0];
      expect((await viewCart(database.app, customerId, loserCart)).body).toMatchObject({ status: 'open' });
      const after = await productStock(database.app);
      expect(after['notebook-set']! + after['enamel-bottle']!).toBe(
        before['notebook-set']! + before['enamel-bottle']! - 1,
      );
      expect(await couponOf(database.app, customerId, coupon.code)).toMatchObject({ redeemed: true });
    }
  });
});

describe('a checkout that fails leaves its coupon available', () => {
  const database = useTestDatabase({ coupons: { everyNOrders: 2 } });
  const orders: OrderCount = { placed: 0 };
  const earned: Record<string, Coupon> = {};

  beforeAll(async () => {
    earned.dave = await earnCoupon(database.app, orders, 'dave');
    earned.erin = await earnCoupon(database.app, orders, 'erin');
    earned.frank = await earnCoupon(database.app, orders, 'frank');
  });

  it('answers a declined payment with 402 PAYMENT_DECLINED, and the same cart then checks out with the coupon', async () => {
    const coupon = earned.dave!;
    // The subtotal is 3,600 cents, so ten per cent takes 360 cents off.
    const cartId = await cartWith(database.app, 'dave', [['canvas-tote', 2]]);
    const stockBefore = await productStock(database.app);

    const declined = await checkOut(database.app, 'dave', cartId, 'dave-retry', 'tok_decline', coupon.code);

    expect(declined.status).toBe(402);
    expect(declined.body).toMatchObject({ status: 402, code: 'PAYMENT_DECLINED' });
    expect(await couponOf(database.app, 'dave', coupon.code)).toMatchObject({ redeemed: false });
    expect(await productStock(database.app)).toEqual(stockBefore);

    const approved = await checkOut(database.app, 'dave', cartId, 'dave-retry', 'tok_ok', coupon.code);

    expect(approved.status).toBe(201);
    expect(approved.body as Order).toMatchObject({
      couponCode: coupon.code,
      subtotalCents: 3600,
      discountCents: 360,
      totalCents: 3240,
    });
  });

  it('answers a checkout refused for stock with 409 INSUFFICIENT_STOCK, and leaves the coupon unredeemed', async () => {
    const coupon = earned.erin!;
    const cartId = await cartWith(database.app, 'erin', [['classic-tee', 1]]);
    // Stock runs out after the line was set, as it does when another customer buys the last tee.
    await database.pool.query("UPDATE products SET stock = 0 WHERE id = 'classic-tee'");

    const refused = await checkOut(database.app, 'erin', cartId, 'erin-retry', undefined, coupon.code);

    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ status: 409, code: 'INSUFFICIENT_STOCK' });
    expect(await couponOf(database.app, 'erin', coupon.code)).toMatchObject({ redeemed: false });

    await database.pool.query("UPDATE products SET stock = 1 WHERE id = 'classic-tee'");
    const retry = await checkOut(database.app, 'erin', cartId, 'erin-retry', undefined, coupon.code);

    expect(retry.status).toBe(201);
    expect(retry.body as Order).toMatchObject({ couponCode: coupon.code });
  });

  it('answers an empty cart with 422 CART_EMPTY, and leaves the coupon unredeemed', async () => {
    const coupon = earned.frank!;
    const cartId = await createCart(database.app, 'frank');

    const response = await checkOut(database.app, 'frank', cartId, undefined, undefined, coupon.code);

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ status: 422, code: 'CART_EMPTY' });
    expect(await couponOf(database.app, 'frank', coupon.code)).toMatchObject({ redeemed: false });
  });
});

describe('coupons a checkout cannot use', () => {
  const database = useTestDatabase({ coupons: { everyNOrders: 2 } });
  const orders: OrderCount = { placed: 0 };
  const earned: Record<string, Coupon> = {};

  beforeAll(async () => {
    earned.heidi = await earnCoupon(database.app, orders, 'heidi');
  });

  it('answers an unknown coupon code with 422 COUPON_NOT_FOUND, and changes nothing', async () => {
    const cartId = await cartWith(database.app, 'grace', [['canvas-tote', 1]]);
    const stockBefore = await productStock(database.app);

    const response = await checkOut(database.app, 'grace', cartId, undefined, undefined, UNISSUED_CODE);
    const cart = (await viewCart(database.app, 'grace', cartId)).body as Cart;

    expect(response.status).toBe(422);
    expect(response.body as Problem).toMatchObject({ status: 422, code: 'COUPON_NOT_FOUND' });
    expect(await productStock(database.app)).toEqual(stockBefore);
    expect(cart.status).toBe('open');
  });

  it("answers another customer's coupon with 422 COUPON_NOT_OWNED, and leaves it for its owner", async () => {
    const coupon = earned.heidi!;
    const cartId = await cartWith(database.app, 'ivan', [['canvas-tote', 1]]);

    const refused = await checkOut(database.app, 'ivan', cartId, undefined, undefined, coupon.code);
    const cart = (await viewCart(database.app, 'ivan', cartId)).body as Cart;

    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ status: 422, code: 'COUPON_NOT_OWNED' });
    expect(cart.status).toBe('open');
    expect(await couponOf(database.app, 'heidi', coupon.code)).toMatchObject({ redeemed: false });

    const owned = await cartWith(database.app, 'heidi', [['canvas-tote', 1]]);
    expect((await checkOut(database.app, 'heidi', owned, undefined, undefined, coupon.code)).status).toBe(201);
  });
});

describe('the coupon is part of the idempotency fingerprint', () => {
  const database = useTestDatabase({ coupons: { everyNOrders: 2 } });
  const orders: OrderCount = { placed: 0 };
  const earned: Record<string, Coupon> = {};

  beforeAll(async () => {
    earned.judyFirst = await earnCoupon(database.app, orders, 'judy');
    earned.judySecond = await earnCoupon(database.app, orders, 'judy');
    earned.kim = await earnCoupon(database.app, orders, 'kim');
  });

  it('replays the original response for the same key, cart and coupon, and refuses the same key with another coupon', async () => {
    const first = earned.judyFirst!;
    const second = earned.judySecond!;
    const cartId = await cartWith(database.app, 'judy', [['ceramic-mug', 1]]);

    const placed = await checkOut(database.app, 'judy', cartId, 'judy-key', undefined, first.code);
    const replay = await checkOut(database.app, 'judy', cartId, 'judy-key', undefined, first.code);
    const changed = await checkOut(database.app, 'judy', cartId, 'judy-key', undefined, second.code);

    expect(placed.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.text).toBe(placed.text);
    expect(changed.status).toBe(422);
    expect(changed.body).toMatchObject({ status: 422, code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(await couponOf(database.app, 'judy', second.code)).toMatchObject({ redeemed: false });
  });

  it('refuses a key that placed an order without a coupon when it is sent again with one', async () => {
    const coupon = earned.kim!;
    const cartId = await cartWith(database.app, 'kim', [['ceramic-mug', 1]]);

    const withoutCoupon = await checkOut(database.app, 'kim', cartId, 'kim-key');
    const withCoupon = await checkOut(database.app, 'kim', cartId, 'kim-key', undefined, coupon.code);

    expect(withoutCoupon.status).toBe(201);
    expect(withCoupon.status).toBe(422);
    expect(withCoupon.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(await couponOf(database.app, 'kim', coupon.code)).toMatchObject({ redeemed: false });
  });
});

describe('the amount charged', () => {
  const payments = new RecordingGateway();
  const database = useTestDatabase({ coupons: { everyNOrders: 2 }, payments });
  const orders: OrderCount = { placed: 0 };
  const earned: Record<string, Coupon> = {};

  beforeAll(async () => {
    earned.lena = await earnCoupon(database.app, orders, 'lena');
  });

  it('charges the discounted total when a coupon is redeemed, and the subtotal when none is given', async () => {
    const withCoupon = await cartWith(database.app, 'lena', [
      ['limited-hoodie', 1],
      ['ceramic-mug', 1],
    ]);
    await checkOut(database.app, 'lena', withCoupon, undefined, undefined, earned.lena!.code);
    expect(payments.charges.at(-1)).toEqual({ amountCents: 9180, paymentToken: 'tok_ok' });

    const withoutCoupon = await cartWith(database.app, 'mona', [['ceramic-mug', 1]]);
    await checkOut(database.app, 'mona', withoutCoupon);
    expect(payments.charges.at(-1)).toEqual({ amountCents: 1200, paymentToken: 'tok_ok' });
  });
});
