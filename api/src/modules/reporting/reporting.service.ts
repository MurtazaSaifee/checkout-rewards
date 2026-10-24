import type { Pool } from 'pg';
import type { CouponRules } from '../../config.js';
import { READ_ONLY_SNAPSHOT, withTransaction } from '../../db/transaction.js';
import { milestonesReached } from '../pricing/pricing.js';
import { readCouponCounts, readOrderTotals, readUnitsSold } from './reporting.repository.js';

/** The admin report, as the route sends it. Every figure is calculated from the orders and coupons on each call. */
export interface ReportView {
  orderCount: number;
  unitsSold: Array<{ productId: string; name: string; quantity: number }>;
  grossRevenueCents: number;
  discountCents: number;
  netRevenueCents: number;
  couponsGenerated: number;
  couponsRedeemed: number;
  couponsAvailable: number;
  unrewardedMilestones: number;
}

/**
 * Builds the report. Reads only: nothing is stored, and nothing is written. The
 * queries run in one read-only snapshot, so every figure describes the same
 * committed state, and a checkout that commits mid-report is seen by none of
 * its figures or by all of them.
 */
export async function buildReport(db: Pool, rules: CouponRules): Promise<ReportView> {
  return withTransaction(
    db,
    async (snapshot) => {
      const totals = await readOrderTotals(snapshot);
      const unitsSold = await readUnitsSold(snapshot);
      const coupons = await readCouponCounts(snapshot);
      return {
        orderCount: totals.orderCount,
        unitsSold,
        grossRevenueCents: totals.grossRevenueCents,
        discountCents: totals.discountCents,
        netRevenueCents: totals.netRevenueCents,
        couponsGenerated: coupons.generated,
        couponsRedeemed: coupons.redeemed,
        couponsAvailable: coupons.generated - coupons.redeemed,
        // Milestones reached by the order count, less the coupons already issued for them.
        unrewardedMilestones: milestonesReached(totals.orderCount, rules.everyNOrders) - coupons.generated,
      };
    },
    READ_ONLY_SNAPSHOT,
  );
}
