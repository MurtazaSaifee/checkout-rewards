import { Router } from 'express';
import type { Pool } from 'pg';
import type { CouponRules } from '../../config.js';
import { buildReport } from './reporting.service.js';

export function reportingRouter(db: Pool, rules: CouponRules): Router {
  const router = Router();

  router.get('/admin/report', async (_req, res) => {
    const report = await buildReport(db, rules);
    res.json(report);
  });

  return router;
}
