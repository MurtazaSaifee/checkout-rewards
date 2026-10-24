import type { PoolClient } from 'pg';
import type { SqlRunner } from '../../db/transaction.js';

/** A coupon as its customer sees it. */
export interface CustomerCouponView {
  code: string;
  percentOff: number;
  milestone: number;
  redeemed: boolean;
}

/** A coupon as an administrator sees it, with the customer it was issued to. */
export interface AdminCouponView {
  code: string;
  percentOff: number;
  milestone: number;
  customerId: string;
  issuedAt: string;
  redeemedByOrderId: string | null;
}

export interface NewCoupon {
  code: string;
  milestone: number;
  customerId: string;
  percentOff: number;
}

interface AdminCouponRow extends Omit<AdminCouponView, 'issuedAt'> {
  issuedAt: Date;
}

/**
 * Locks the order-number counter row and returns the number of orders placed.
 * Checkout takes this row as its last write, so holding the lock until the
 * caller's transaction ends keeps the count stable, and waits for any checkout
 * that is still placing an order.
 */
export async function lockOrderCount(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ orderCount: number }>(
    'SELECT last_order_number AS "orderCount" FROM order_counter WHERE id = 1 FOR UPDATE',
  );
  const [row] = rows;
  if (row === undefined) {
    throw new Error('order_counter has no row, so the order count cannot be read');
  }
  return row.orderCount;
}

/** How many coupons have been issued. Milestones are rewarded in order, so this is the last milestone rewarded. */
export async function countIssuedCoupons(runner: SqlRunner): Promise<number> {
  const { rows } = await runner.query<{ issued: number }>('SELECT count(*)::int AS issued FROM coupons');
  const [row] = rows;
  if (row === undefined) {
    throw new Error('count(*) produced no row');
  }
  return row.issued;
}

/** The customer who placed the order with this number, or undefined if no such order exists. */
export async function findCustomerOfOrder(runner: SqlRunner, orderNumber: number): Promise<string | undefined> {
  const { rows } = await runner.query<{ customerId: string }>(
    'SELECT customer_id AS "customerId" FROM orders WHERE order_number = $1',
    [orderNumber],
  );
  return rows[0]?.customerId;
}

export async function insertCoupon(client: PoolClient, coupon: NewCoupon): Promise<void> {
  await client.query(
    'INSERT INTO coupons (code, milestone, customer_id, percent_off) VALUES ($1, $2, $3, $4)',
    [coupon.code, coupon.milestone, coupon.customerId, coupon.percentOff],
  );
}

/** A coupon as checkout reads it while holding its row lock. */
export interface LockedCouponRow {
  code: string;
  customerId: string;
  percentOff: number;
  redeemedByOrderId: string | null;
}

/**
 * Locks the coupon's row until the caller's transaction ends, and returns it, or
 * undefined when no coupon has the code. A second checkout that names the same
 * coupon waits here, then reads the row after the first one commits, so it sees
 * the redemption rather than an outdated, unredeemed row.
 */
export async function lockCouponByCode(client: PoolClient, code: string): Promise<LockedCouponRow | undefined> {
  const { rows } = await client.query<LockedCouponRow>(
    `SELECT code, customer_id AS "customerId", percent_off AS "percentOff",
            redeemed_by_order_id AS "redeemedByOrderId"
       FROM coupons
      WHERE code = $1
        FOR UPDATE`,
    [code],
  );
  return rows[0];
}

/** Marks the coupon redeemed by the order. Runs only in the checkout transaction that holds the coupon's lock. */
export async function markCouponRedeemed(client: PoolClient, code: string, orderId: string): Promise<void> {
  await client.query('UPDATE coupons SET redeemed_by_order_id = $2 WHERE code = $1', [code, orderId]);
}

/** The coupons issued to one customer, in milestone order. */
export async function listCouponsOfCustomer(runner: SqlRunner, customerId: string): Promise<CustomerCouponView[]> {
  const { rows } = await runner.query<CustomerCouponView>(
    `SELECT code, percent_off AS "percentOff", milestone,
            redeemed_by_order_id IS NOT NULL AS redeemed
       FROM coupons
      WHERE customer_id = $1
      ORDER BY milestone`,
    [customerId],
  );
  return rows;
}

/** Every coupon, in milestone order, with the customer it was issued to. */
export async function listAllCoupons(runner: SqlRunner): Promise<AdminCouponView[]> {
  const { rows } = await runner.query<AdminCouponRow>(
    `SELECT code, percent_off AS "percentOff", milestone, customer_id AS "customerId",
            issued_at AS "issuedAt", redeemed_by_order_id AS "redeemedByOrderId"
       FROM coupons
      ORDER BY milestone`,
  );
  return rows.map((row) => ({ ...row, issuedAt: row.issuedAt.toISOString() }));
}
