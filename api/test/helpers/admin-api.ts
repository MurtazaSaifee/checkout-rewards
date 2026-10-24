import request, { type Test } from 'supertest';
import type { Express } from 'express';
import { TEST_ADMIN_KEY } from './test-database.js';

/**
 * Thin wrappers over the administrator's read operations. Each returns the raw response so tests can assert on it.
 * Pass adminKey as null to send no admin key header at all.
 */

export function withAdminKey(test: Test, adminKey: string | null): Test {
  return adminKey === null ? test : test.set('X-Admin-Key', adminKey);
}

export function getReport(app: Express, adminKey: string | null = TEST_ADMIN_KEY) {
  return withAdminKey(request(app).get('/api/admin/report'), adminKey);
}

export function listAllOrders(app: Express, adminKey: string | null = TEST_ADMIN_KEY) {
  return withAdminKey(request(app).get('/api/admin/orders'), adminKey);
}
