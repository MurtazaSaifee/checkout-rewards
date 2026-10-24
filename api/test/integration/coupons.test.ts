import { describe, expect, it } from 'vitest';
import { useTestDatabase } from '../helpers/test-database.js';
import { generateCoupon, listAllCoupons } from '../helpers/coupon-api.js';
import type { Problem } from '../helpers/api-types.js';

describe('the admin key on coupon operations', () => {
  const database = useTestDatabase({ coupons: { everyNOrders: 2 } });

  it.each([
    ['generating a coupon', (key: string | null) => generateCoupon(database.app, key)],
    ['listing all coupons', (key: string | null) => listAllCoupons(database.app, key)],
  ])('answers %s without the admin key with 401 ADMIN_KEY_INVALID', async (_label, send) => {
    const response = await send(null);
    const body = response.body as Problem;

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ status: 401, code: 'ADMIN_KEY_INVALID' });
    expect(body.requestId).toBe(response.headers['x-request-id']);
  });

  it.each([
    ['generating a coupon', (key: string | null) => generateCoupon(database.app, key)],
    ['listing all coupons', (key: string | null) => listAllCoupons(database.app, key)],
  ])('answers %s with a wrong admin key with 401 ADMIN_KEY_INVALID', async (_label, send) => {
    const response = await send('not-the-admin-key');

    expect(response.status).toBe(401);
    expect(response.body as Problem).toMatchObject({ status: 401, code: 'ADMIN_KEY_INVALID' });
  });

  it('treats a blank admin key as wrong', async () => {
    const response = await generateCoupon(database.app, '');

    expect(response.status).toBe(401);
    expect(response.body as Problem).toMatchObject({ code: 'ADMIN_KEY_INVALID' });
  });
});
