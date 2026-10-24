import type { SqlRunner } from '../../db/transaction.js';

/** Order count and the money totals over every placed order, in cents. */
export interface OrderTotals {
  orderCount: number;
  grossRevenueCents: number;
  discountCents: number;
  netRevenueCents: number;
}

/** Coupons issued, and how many of them an order has redeemed. */
export interface CouponCounts {
  generated: number;
  redeemed: number;
}

/** Units sold of one product across every placed order. */
export interface UnitsSoldRow {
  productId: string;
  name: string;
  quantity: number;
}

/**
 * Postgres returns a bigint sum as text, so each sum is converted here. Cents stay
 * exact while they are below 2^53, which is far beyond any store's revenue.
 */
function wholeNumber(value: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new Error(`${value} is not a safe whole number`);
  }
  return number;
}

/** Counts the placed orders and sums their money. Reads orders only. */
export async function readOrderTotals(runner: SqlRunner): Promise<OrderTotals> {
  const { rows } = await runner.query<{
    orderCount: number;
    grossRevenueCents: string;
    discountCents: string;
    netRevenueCents: string;
  }>(
    `SELECT count(*)::int                       AS "orderCount",
            coalesce(sum(subtotal_cents), 0)   AS "grossRevenueCents",
            coalesce(sum(discount_cents), 0)   AS "discountCents",
            coalesce(sum(total_cents), 0)      AS "netRevenueCents"
       FROM orders`,
  );
  const [row] = rows;
  if (row === undefined) {
    throw new Error('the order totals query produced no row');
  }
  return {
    orderCount: row.orderCount,
    grossRevenueCents: wholeNumber(row.grossRevenueCents),
    discountCents: wholeNumber(row.discountCents),
    netRevenueCents: wholeNumber(row.netRevenueCents),
  };
}

/** Units sold per product, summed over every order line, in product identifier order. */
export async function readUnitsSold(runner: SqlRunner): Promise<UnitsSoldRow[]> {
  const { rows } = await runner.query<{ productId: string; name: string; quantity: string }>(
    `SELECT ol.product_id AS "productId", p.name, sum(ol.quantity) AS quantity
       FROM order_lines ol
       JOIN products p ON p.id = ol.product_id
      GROUP BY ol.product_id, p.name
      ORDER BY ol.product_id`,
  );
  return rows.map((row) => ({
    productId: row.productId,
    name: row.name,
    quantity: wholeNumber(row.quantity),
  }));
}

/** Counts the coupons issued and the coupons redeemed. Reads coupons only. */
export async function readCouponCounts(runner: SqlRunner): Promise<CouponCounts> {
  const { rows } = await runner.query<CouponCounts>(
    `SELECT count(*)::int                       AS generated,
            count(redeemed_by_order_id)::int    AS redeemed
       FROM coupons`,
  );
  const [row] = rows;
  if (row === undefined) {
    throw new Error('the coupon counts query produced no row');
  }
  return row;
}
