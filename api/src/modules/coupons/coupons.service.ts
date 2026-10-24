import type { Pool } from 'pg';
import type { CouponRules } from '../../config.js';
import { withTransaction } from '../../db/transaction.js';
import { milestonesReached } from '../pricing/pricing.js';
import { newCouponCode } from './coupon.codes.js';
import { NoEligibleMilestoneError } from './coupon.errors.js';
import {
  type AdminCouponView,
  type CustomerCouponView,
  countIssuedCoupons,
  findCustomerOfOrder,
  insertCoupon,
  listAllCoupons as selectAllCoupons,
  listCouponsOfCustomer,
  lockOrderCount,
} from './coupons.repository.js';

/** The answer to generating a coupon: the coupon, the customer it went to, and what is still owed. */
export interface GeneratedCouponView {
  coupon: CustomerCouponView;
  customerId: string;
  unrewardedMilestonesRemaining: number;
}

/**
 * Issues a coupon for the oldest unrewarded milestone. Milestone k is reached by
 * the order numbered k × n, and its coupon goes to the customer who placed that
 * order. At most one coupon is issued per call.
 *
 * The order-number counter is locked first. Checkouts take that row as their
 * last write, so the lock both waits for any checkout still placing an order and
 * stops another from placing one, which makes the count and the next milestone
 * stable. Two calls that overlap queue on the lock, and the second one sees the
 * first one's coupon. The unique milestone constraint is the backstop.
 */
export async function generateCoupon(db: Pool, rules: CouponRules): Promise<GeneratedCouponView> {
  return withTransaction(db, async (client) => {
    const orderCount = await lockOrderCount(client);
    const reached = milestonesReached(orderCount, rules.everyNOrders);
    const milestone = (await countIssuedCoupons(client)) + 1;
    if (milestone > reached) {
      throw new NoEligibleMilestoneError();
    }

    const milestoneOrderNumber = milestone * rules.everyNOrders;
    const customerId = await findCustomerOfOrder(client, milestoneOrderNumber);
    if (customerId === undefined) {
      throw new Error(`order ${milestoneOrderNumber} is missing although ${orderCount} orders were placed`);
    }

    const code = newCouponCode();
    await insertCoupon(client, { code, milestone, customerId, percentOff: rules.percentOff });

    return {
      coupon: { code, percentOff: rules.percentOff, milestone, redeemed: false },
      customerId,
      unrewardedMilestonesRemaining: reached - milestone,
    };
  });
}

/** The calling customer's coupons, in milestone order. */
export function listMyCoupons(db: Pool, customerId: string): Promise<CustomerCouponView[]> {
  return listCouponsOfCustomer(db, customerId);
}

/** Every coupon issued, in milestone order, with its customer. */
export function listAllCoupons(db: Pool): Promise<AdminCouponView[]> {
  return selectAllCoupons(db);
}
