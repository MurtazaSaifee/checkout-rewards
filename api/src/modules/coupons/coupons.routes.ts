import { Router } from 'express';
import type { Pool } from 'pg';
import type { CouponRules } from '../../config.js';
import { customerIdOf } from '../../http/customer-identity.js';
import { generateCoupon, listAllCoupons, listMyCoupons } from './coupons.service.js';

export function couponsRouter(db: Pool, rules: CouponRules): Router {
  const router = Router();

  router.get('/coupons', async (req, res) => {
    const coupons = await listMyCoupons(db, customerIdOf(req));
    res.json({ coupons });
  });

  router.get('/admin/coupons', async (_req, res) => {
    const coupons = await listAllCoupons(db);
    res.json({ coupons });
  });

  router.post('/admin/coupons', async (req, res) => {
    const generated = await generateCoupon(db, rules);
    // The code is a reward that is not yet used, so the log records the milestone and not the code.
    req.log.info({ milestone: generated.coupon.milestone }, 'coupon issued');
    res.status(201).json(generated);
  });

  return router;
}
