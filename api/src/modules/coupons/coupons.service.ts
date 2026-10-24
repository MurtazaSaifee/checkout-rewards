import type { Pool, PoolClient } from 'pg';
import type { CouponRules } from '../../config.js';
import { withTransaction } from '../../db/transaction.js';
import { unrewardedMilestones } from '../pricing/pricing.js';
import { newCouponCode } from './coupon.codes.js';
import {
  CouponAlreadyRedeemedError,
  CouponNotFoundError,
  CouponNotOwnedError,
  NoEligibleMilestoneError,
} from './coupon.errors.js';
import {
  type AdminCouponView,
  type CustomerCouponView,
  countIssuedCoupons,
  findCustomerOfOrder,
  insertCoupon,
  listAllCoupons as selectAllCoupons,
  listCouponsOfCustomer,
  lockCouponByCode,
  lockOrderCount,
} from './coupons.repository.js';
import { isUniqueViolation } from '../../db/unique-violation.js';

/** The unique constraint on the milestone column: one coupon per milestone. */
const MILESTONE_CONSTRAINT = 'coupons_milestone_key';

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
    const issued = await countIssuedCoupons(client);
    if (unrewardedMilestones(orderCount, issued, rules.everyNOrders) < 1) {
      throw new NoEligibleMilestoneError();
    }
    const milestone = issued + 1;

    const milestoneOrderNumber = milestone * rules.everyNOrders;
    const customerId = await findCustomerOfOrder(client, milestoneOrderNumber);
    if (customerId === undefined) {
      throw new Error(`order ${milestoneOrderNumber} is missing although ${orderCount} orders were placed`);
    }

    const code = newCouponCode();
    try {
      await insertCoupon(client, { code, milestone, customerId, percentOff: rules.percentOff });
    } catch (error) {
      // Another call rewarded this milestone first, so the constraint refused the insert.
      if (isUniqueViolation(error, MILESTONE_CONSTRAINT)) {
        throw new NoEligibleMilestoneError();
      }
      throw error;
    }

    return {
      coupon: { code, percentOff: rules.percentOff, milestone, redeemed: false },
      customerId,
      unrewardedMilestonesRemaining: unrewardedMilestones(orderCount, milestone, rules.everyNOrders),
    };
  });
}

/** A coupon that a checkout has locked and found redeemable by the customer. */
export interface RedeemableCoupon {
  code: string;
  percentOff: number;
}

/**
 * Locks the coupon a checkout names, and checks that the customer may redeem it: it
 * exists, it was issued to this customer, and no order has redeemed it yet. The
 * lock is held until the checkout's transaction ends, so the redemption is decided
 * against the committed state, and a concurrent checkout with the same coupon waits.
 */
export async function lockRedeemableCoupon(
  client: PoolClient,
  code: string,
  customerId: string,
): Promise<RedeemableCoupon> {
  const coupon = await lockCouponByCode(client, code);
  if (coupon === undefined) {
    throw new CouponNotFoundError();
  }
  if (coupon.customerId !== customerId) {
    throw new CouponNotOwnedError();
  }
  if (coupon.redeemedByOrderId !== null) {
    throw new CouponAlreadyRedeemedError();
  }
  return { code: coupon.code, percentOff: coupon.percentOff };
}

/** The calling customer's coupons, in milestone order. */
export function listMyCoupons(db: Pool, customerId: string): Promise<CustomerCouponView[]> {
  return listCouponsOfCustomer(db, customerId);
}

/** Every coupon issued, in milestone order, with its customer. */
export function listAllCoupons(db: Pool): Promise<AdminCouponView[]> {
  return selectAllCoupons(db);
}
