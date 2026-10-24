import type { Pool } from 'pg';
import type { SqlRunner } from '../../db/transaction.js';
import { lineAmountCents, subtotalCents } from '../pricing/pricing.js';
import { CartNotFoundError } from './cart.errors.js';
import {
  type CartHead,
  type CartStatus,
  findOwnedCart,
  insertCart,
  selectCartLines,
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
