import type { PoolClient } from 'pg';
import type { CartLineRow } from '../carts/carts.repository.js';
import { lineAmountCents } from '../pricing/pricing.js';

/**
 * Takes the next order number. The counter row is incremented in place, so the
 * row lock is held until the checkout commits. Runs only inside the checkout
 * transaction, as its last write before the order insert.
 */
export async function takeNextOrderNumber(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ orderNumber: number }>(
    `UPDATE order_counter
        SET last_order_number = last_order_number + 1
      WHERE id = 1
  RETURNING last_order_number AS "orderNumber"`,
  );
  const [row] = rows;
  if (row === undefined) {
    throw new Error('order_counter has no row, so no order number can be taken');
  }
  return row.orderNumber;
}

export interface NewOrder {
  orderNumber: number;
  customerId: string;
  cartId: string;
  subtotalCents: number;
  /** The coupon the order redeems, with the percentage it takes off. Both are null when no coupon is used. */
  coupon: { code: string; percentOff: number } | null;
  discountCents: number;
  totalCents: number;
}

/** Inserts the order head and returns its identifier. */
export async function insertOrder(client: PoolClient, order: NewOrder): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO orders (order_number, customer_id, cart_id, subtotal_cents,
                         coupon_code, coupon_percent_off, discount_cents, total_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      order.orderNumber,
      order.customerId,
      order.cartId,
      order.subtotalCents,
      order.coupon?.code ?? null,
      order.coupon?.percentOff ?? null,
      order.discountCents,
      order.totalCents,
    ],
  );
  const [row] = rows;
  if (row === undefined) {
    throw new Error('INSERT ... RETURNING produced no row');
  }
  return row.id;
}

/** Copies each cart line into the order, with the product's name and price as they are now. */
export async function insertOrderLines(
  client: PoolClient,
  orderId: string,
  lines: readonly CartLineRow[],
): Promise<void> {
  for (const line of lines) {
    await client.query(
      `INSERT INTO order_lines
         (order_id, product_id, product_name, unit_price_cents, quantity, line_amount_cents)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [orderId, line.productId, line.name, line.unitPriceCents, line.quantity, lineAmountCents(line)],
    );
  }
}
