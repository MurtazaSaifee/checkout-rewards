import type { SqlRunner } from '../../db/transaction.js';

/** A line of a placed order, as it was at checkout. */
export interface OrderLineView {
  productId: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
  lineAmountCents: number;
}

/** A placed order as clients see it. Everything in it is a snapshot taken at checkout. */
export interface OrderView {
  id: string;
  orderNumber: number;
  placedAt: string;
  lines: OrderLineView[];
  subtotalCents: number;
  totalCents: number;
}

interface OrderHeadRow {
  id: string;
  orderNumber: number;
  placedAt: Date;
  subtotalCents: number;
  totalCents: number;
}

interface OrderLineRow extends OrderLineView {
  orderId: string;
}

const HEAD_COLUMNS = `id, order_number AS "orderNumber", placed_at AS "placedAt",
                      subtotal_cents AS "subtotalCents", total_cents AS "totalCents"`;

/** Reads a placed order and its lines. The caller has already established that it may see the order. */
export async function loadOrderView(runner: SqlRunner, orderId: string): Promise<OrderView> {
  const { rows } = await runner.query<OrderHeadRow>(
    `SELECT ${HEAD_COLUMNS} FROM orders WHERE id = $1`,
    [orderId],
  );
  const [view] = await withLines(runner, rows);
  if (view === undefined) {
    throw new Error(`order ${orderId} vanished while it was being read`);
  }
  return view;
}

/** One order, if it exists and belongs to the customer. Another customer's order is simply absent. */
export async function findOwnedOrderView(
  runner: SqlRunner,
  orderId: string,
  customerId: string,
): Promise<OrderView | undefined> {
  const { rows } = await runner.query<OrderHeadRow>(
    `SELECT ${HEAD_COLUMNS} FROM orders WHERE id = $1 AND customer_id = $2`,
    [orderId, customerId],
  );
  const [view] = await withLines(runner, rows);
  return view;
}

/** Every order the customer has placed, in order-number order. */
export async function listOwnedOrderViews(runner: SqlRunner, customerId: string): Promise<OrderView[]> {
  const { rows } = await runner.query<OrderHeadRow>(
    `SELECT ${HEAD_COLUMNS} FROM orders WHERE customer_id = $1 ORDER BY order_number`,
    [customerId],
  );
  return withLines(runner, rows);
}

/** Attaches each order's lines to its head, with two statements however many orders there are. */
async function withLines(runner: SqlRunner, heads: readonly OrderHeadRow[]): Promise<OrderView[]> {
  if (heads.length === 0) {
    return [];
  }

  const { rows: lines } = await runner.query<OrderLineRow>(
    `SELECT order_id AS "orderId", product_id AS "productId", product_name AS name,
            unit_price_cents AS "unitPriceCents", quantity, line_amount_cents AS "lineAmountCents"
       FROM order_lines
      WHERE order_id = ANY($1::uuid[])
      ORDER BY product_id`,
    [heads.map((head) => head.id)],
  );

  return heads.map((head) => ({
    id: head.id,
    orderNumber: head.orderNumber,
    placedAt: head.placedAt.toISOString(),
    lines: lines
      .filter((line) => line.orderId === head.id)
      .map(({ productId, name, unitPriceCents, quantity, lineAmountCents }) => ({
        productId,
        name,
        unitPriceCents,
        quantity,
        lineAmountCents,
      })),
    subtotalCents: head.subtotalCents,
    totalCents: head.totalCents,
  }));
}
