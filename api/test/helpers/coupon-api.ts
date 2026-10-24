import request from 'supertest';
import type { Express } from 'express';
import { TEST_ADMIN_KEY } from './test-database.js';
import { withAdminKey } from './admin-api.js';

/**
 * Thin wrappers over the coupon endpoints. Each returns the raw response so tests can assert on it.
 * Pass adminKey as null to send no admin key header at all.
 */

export function generateCoupon(app: Express, adminKey: string | null = TEST_ADMIN_KEY) {
  return withAdminKey(request(app).post('/api/admin/coupons'), adminKey);
}

export function listAllCoupons(app: Express, adminKey: string | null = TEST_ADMIN_KEY) {
  return withAdminKey(request(app).get('/api/admin/coupons'), adminKey);
}

export function listMyCoupons(app: Express, customerId: string) {
  return request(app).get('/api/coupons').set('X-Customer-Id', customerId);
}
