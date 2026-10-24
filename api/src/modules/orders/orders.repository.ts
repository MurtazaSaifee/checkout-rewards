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
  /** The coupon the order redeemed, or null when it redeemed none. */
  couponCode: string | null;
  /** The percentage the coupon took off, or null when the order redeemed none. */
  couponPercentOff: number | null;
  discountCents: number;
  totalCents: number;
}

interface OrderHeadRow {
  id: string;
  orderNumber: number;
  placedAt: Date;
  subtotalCents: number;
  couponCode: string | null;
  couponPercentOff: number | null;
  discountCents: number;
  totalCents: number;
}

interface OrderLineRow extends OrderLineView {
  orderId: string;
}

const HEAD_COLUMNS = `id, order_number AS "orderNumber", placed_at AS "placedAt",
                      subtotal_cents AS "subtotalCents", coupon_code AS "couponCode",
                      coupon_percent_off AS "couponPercentOff",
                      discount_cents AS "discountCents", total_cents AS "totalCents"`;

/** Reads a placed order and its lines. The caller has already established that it may see the order. */
export async function loadOrderView(runner: SqlRunner, orderId: string): Promise<OrderView> {
  const { rows } = await runner.query<OrderHeadRow>(
    `SELECT ${HEAD_COLUMNS} FROM orders WHERE id = $1`,
    [orderId],
  );
  const [view] = await withLines(runner, rows, orderViewOf);
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
  const [view] = await withLines(runner, rows, orderViewOf);
  return view;
}

/** Every order the customer has placed, in order-number order. */
export async function listOwnedOrderViews(runner: SqlRunner, customerId: string): Promise<OrderView[]> {
  const { rows } = await runner.query<OrderHeadRow>(
    `SELECT ${HEAD_COLUMNS} FROM orders WHERE customer_id = $1 ORDER BY order_number`,
    [customerId],
  );
  return withLines(runner, rows, orderViewOf);
}

/** The view of one order as a customer sees it: its head, and the lines it had at checkout. */
function orderViewOf(head: OrderHeadRow, lines: OrderLineView[]): OrderView {
  return {
    id: head.id,
    orderNumber: head.orderNumber,
    placedAt: head.placedAt.toISOString(),
    lines,
    subtotalCents: head.subtotalCents,
    couponCode: head.couponCode,
    couponPercentOff: head.couponPercentOff,
    discountCents: head.discountCents,
    totalCents: head.totalCents,
  };
}

/**
 * Attaches each order's lines to its head, with two statements however many orders
 * there are, and builds each view with viewOf. The lines are read in one query and
 * matched to their heads, so every caller shares the same line handling.
 */
async function withLines<Head extends OrderHeadRow, View>(
  runner: SqlRunner,
  heads: readonly Head[],
  viewOf: (head: Head, lines: OrderLineView[]) => View,
): Promise<View[]> {
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

  return heads.map((head) =>
    viewOf(
      head,
      lines
        .filter((line) => line.orderId === head.id)
        .map(({ productId, name, unitPriceCents, quantity, lineAmountCents }) => ({
          productId,
          name,
          unitPriceCents,
          quantity,
          lineAmountCents,
        })),
    ),
  );
}

/** A placed order as the administrator sees it: the order a customer views, and the customer it belongs to. */
export interface AdminOrderView extends OrderView {
  customerId: string;
}

interface AdminOrderHeadRow extends OrderHeadRow {
  customerId: string;
}

/** Every placed order with the customer it belongs to, in order-number order. For the administrator only. */
export async function listAllOrderViews(runner: SqlRunner): Promise<AdminOrderView[]> {
  const { rows } = await runner.query<AdminOrderHeadRow>(
    `SELECT ${HEAD_COLUMNS}, customer_id AS "customerId" FROM orders ORDER BY order_number`,
  );
  return withLines(runner, rows, (head, lines) => ({
    ...orderViewOf(head, lines),
    customerId: head.customerId,
  }));
}
