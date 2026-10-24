import type { PoolClient, QueryResultRow } from 'pg';
import { singleRow } from '../../db/rows.js';
import type { SqlRunner } from '../../db/transaction.js';
import { CartAlreadyCheckedOutError, CartNotFoundError } from './cart.errors.js';

export type CartStatus = 'open' | 'checked_out';

export interface CartHead {
  id: string;
  status: CartStatus;
}

/** A cart line as stored, joined with the product's current name and price. */
export interface CartLineRow extends QueryResultRow {
  productId: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
}

/** Inserts an empty open cart for the customer and returns its identifier. */
export async function insertCart(runner: SqlRunner, customerId: string): Promise<string> {
  const { rows } = await runner.query<{ id: string }>(
    'INSERT INTO carts (customer_id) VALUES ($1) RETURNING id',
    [customerId],
  );
  const row = singleRow(rows, 'INSERT ... RETURNING produced no row');
  return row.id;
}

/**
 * A cart the customer owns, read without a lock. Another customer's cart is
 * simply absent from the result.
 */
export async function findOwnedCart(
  runner: SqlRunner,
  cartId: string,
  customerId: string,
): Promise<CartHead | undefined> {
  const { rows } = await runner.query<CartHead>(
    'SELECT id, status FROM carts WHERE id = $1 AND customer_id = $2',
    [cartId, customerId],
  );
  return rows[0];
}

/**
 * Locks the cart row until the caller's transaction ends, and rejects a cart the
 * customer may not change. Every cart edit starts here, and so does checkout:
 * the lock serialises concurrent changes to one cart. A caller that waits on
 * the lock re-reads the row once the holder commits, so it sees the checked-out
 * status rather than an outdated one.
 */
export async function lockEditableCart(
  client: PoolClient,
  cartId: string,
  customerId: string,
): Promise<CartHead> {
  const { rows } = await client.query<CartHead>(
    'SELECT id, status FROM carts WHERE id = $1 AND customer_id = $2 FOR UPDATE',
    [cartId, customerId],
  );
  const head = rows[0];
  if (head === undefined) {
    throw new CartNotFoundError();
  }
  if (head.status === 'checked_out') {
    throw new CartAlreadyCheckedOutError();
  }
  return head;
}

/**
 * Sets the quantity of a product in the cart, creating the line if needed. The
 * quantity replaces any earlier one, so repeating the statement changes nothing.
 * Runs only inside a transaction that already holds the cart lock.
 */
export async function upsertCartLine(
  client: PoolClient,
  cartId: string,
  productId: string,
  quantity: number,
): Promise<void> {
  await client.query(
    `INSERT INTO cart_lines (cart_id, product_id, quantity)
     VALUES ($1, $2, $3)
     ON CONFLICT (cart_id, product_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
    [cartId, productId, quantity],
  );
}

/**
 * Removes a product's line from the cart. Removing a line that is already gone
 * changes nothing. Runs only inside a transaction that already holds the cart lock.
 */
export async function deleteCartLine(
  client: PoolClient,
  cartId: string,
  productId: string,
): Promise<void> {
  await client.query('DELETE FROM cart_lines WHERE cart_id = $1 AND product_id = $2', [
    cartId,
    productId,
  ]);
}

/**
 * Marks the cart as checked out, so no further change is accepted. Runs only
 * inside the checkout transaction, which already holds the cart lock.
 */
export async function markCartCheckedOut(client: PoolClient, cartId: string): Promise<void> {
  await client.query("UPDATE carts SET status = 'checked_out' WHERE id = $1", [cartId]);
}

/** The cart's lines with each product's current name and unit price, in product order. */
export async function selectCartLines(runner: SqlRunner, cartId: string): Promise<CartLineRow[]> {
  const { rows } = await runner.query<CartLineRow>(
    `SELECT cl.product_id AS "productId", p.name, p.unit_price_cents AS "unitPriceCents", cl.quantity
       FROM cart_lines cl
       JOIN products p ON p.id = cl.product_id
      WHERE cl.cart_id = $1
      ORDER BY cl.product_id`,
    [cartId],
  );
  return rows;
}
