import type { Pool } from 'pg';
import { type SqlRunner, withTransaction } from '../../db/transaction.js';
import { lineAmountCents, subtotalCents } from '../pricing/pricing.js';
import { findProduct } from '../products/products.repository.js';
import {
  CartNotFoundError,
  InsufficientStockError,
  ProductNotFoundError,
} from './cart.errors.js';
import {
  type CartHead,
  type CartStatus,
  deleteCartLine,
  findOwnedCart,
  insertCart,
  lockEditableCart,
  selectCartLines,
  upsertCartLine,
} from './carts.repository.js';

/** A cart as clients see it. Prices are read now, so a view is never stale. */
export interface CartView {
  id: string;
  status: CartStatus;
  lines: Array<{
    productId: string;
    name: string;
    unitPriceCents: number;
    quantity: number;
    lineAmountCents: number;
  }>;
  lineCount: number;
  subtotalCents: number;
}

export async function createCart(db: Pool, customerId: string): Promise<CartView> {
  const id = await insertCart(db, customerId);
  return loadCartView(db, { id, status: 'open' });
}

export async function viewCart(db: Pool, cartId: string, customerId: string): Promise<CartView> {
  const head = await findOwnedCart(db, cartId, customerId);
  if (head === undefined) {
    throw new CartNotFoundError();
  }
  return loadCartView(db, head);
}

export interface SetLineQuantityInput {
  cartId: string;
  customerId: string;
  productId: string;
  quantity: number;
}

/**
 * Sets a line's quantity and returns the cart. The cart row is locked for the
 * whole transaction, so the change is either fully in place before a concurrent
 * checkout reads the cart, or rejected because the cart was already checked out.
 */
export async function setLineQuantity(db: Pool, input: SetLineQuantityInput): Promise<CartView> {
  return withTransaction(db, async (client) => {
    const head = await lockEditableCart(client, input.cartId, input.customerId);

    const product = await findProduct(client, input.productId);
    if (product === undefined) {
      throw new ProductNotFoundError(input.productId);
    }
    // A courtesy check: stock is not held here and is taken only at checkout.
    if (input.quantity > product.stock) {
      throw new InsufficientStockError([
        { productId: product.id, requested: input.quantity, available: product.stock },
      ]);
    }

    await upsertCartLine(client, head.id, input.productId, input.quantity);
    return loadCartView(client, head);
  });
}

export interface RemoveLineInput {
  cartId: string;
  customerId: string;
  productId: string;
}

/** Removes a line under the cart lock and returns the cart. */
export async function removeCartLine(db: Pool, input: RemoveLineInput): Promise<CartView> {
  return withTransaction(db, async (client) => {
    const head = await lockEditableCart(client, input.cartId, input.customerId);
    await deleteCartLine(client, head.id, input.productId);
    return loadCartView(client, head);
  });
}

/** Builds the view of a cart whose ownership the caller has already established. */
async function loadCartView(runner: SqlRunner, head: CartHead): Promise<CartView> {
  const rows = await selectCartLines(runner, head.id);
  return {
    id: head.id,
    status: head.status,
    lines: rows.map((row) => ({ ...row, lineAmountCents: lineAmountCents(row) })),
    lineCount: rows.length,
    subtotalCents: subtotalCents(rows),
  };
}
