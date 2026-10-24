import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { useTestDatabase } from '../helpers/test-database.js';
import { getReport } from '../helpers/admin-api.js';
import { createCart, setLine } from '../helpers/cart-api.js';
import { checkOut, listMyOrders, placeOrder } from '../helpers/checkout-api.js';
import { generateCoupon, listAllCoupons, listMyCoupons } from '../helpers/coupon-api.js';
import type { Coupon, Problem, ProductListing, Report } from '../helpers/api-types.js';

describe('the admin report of a store with no orders', () => {
  const database = useTestDatabase({ coupons: { everyNOrders: 2 } });

  it('answers zero orders, no units sold and no coupons, with 200', async () => {
    const response = await getReport(database.app);

    expect(response.status).toBe(200);
    expect(response.body as Report).toEqual({
      orderCount: 0,
      unitsSold: [],
      grossRevenueCents: 0,
      discountCents: 0,
      netRevenueCents: 0,
      couponsGenerated: 0,
      couponsRedeemed: 0,
      couponsAvailable: 0,
      unrewardedMilestones: 0,
    });
  });
});

describe('the admin report of placed orders without coupons', () => {
  const database = useTestDatabase({ coupons: { everyNOrders: 2 } });

  beforeAll(async () => {
    // Order 1 is 2 x 2,500 = 5,000. Order 2 is 1,800 + 1,200 = 3,000. Order 3 is 2,500 + 2 x 950 = 4,400.
    await placeOrder(database.app, 'alice', [['classic-tee', 2]]);
    await placeOrder(database.app, 'bob', [
      ['canvas-tote', 1],
      ['ceramic-mug', 1],
    ]);
    await placeOrder(database.app, 'carol', [
      ['classic-tee', 1],
      ['notebook-set', 2],
    ]);
  });

  it('reports the order count, units by product, and gross, discount and net revenue in cents', async () => {
    const response = await getReport(database.app);

    expect(response.status).toBe(200);
    expect(response.body as Report).toMatchObject({
      orderCount: 3,
      unitsSold: [
        { productId: 'canvas-tote', name: 'Canvas Tote Bag', quantity: 1 },
        { productId: 'ceramic-mug', name: 'Ceramic Mug', quantity: 1 },
        { productId: 'classic-tee', name: 'Classic Cotton Tee', quantity: 3 },
        { productId: 'notebook-set', name: 'Notebook Set', quantity: 2 },
      ],
      grossRevenueCents: 12400,
      discountCents: 0,
      netRevenueCents: 12400,
    });
  });
});

describe('the admin key on the report', () => {
  const database = useTestDatabase();

  it.each([
    ['without the admin key', null],
    ['with a wrong admin key', 'not-the-admin-key'],
  ])('answers the report %s with 401 ADMIN_KEY_INVALID', async (_label, key) => {
    const response = await getReport(database.app, key);

    expect(response.status).toBe(401);
    expect(response.body as Problem).toMatchObject({ status: 401, code: 'ADMIN_KEY_INVALID' });
  });
});

describe('reading the report', () => {
  const database = useTestDatabase({ coupons: { everyNOrders: 2 } });

  beforeAll(async () => {
    await placeOrder(database.app, 'alice', [['classic-tee', 1]]);
    await placeOrder(database.app, 'bob', [['canvas-tote', 1]]);
  });

  it('answers two consecutive requests with identical bodies', async () => {
    const first = await getReport(database.app);
    const second = await getReport(database.app);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.text).toBe(first.text);
  });

  it('changes no state: orders, coupons and stock are the same after any number of reads', async () => {
    const productsBefore = (await request(database.app).get('/api/products')).body as ProductListing;
    const couponsBefore = (await listAllCoupons(database.app)).body;
    const aliceOrdersBefore = (await listMyOrders(database.app, 'alice')).body;

    await getReport(database.app);
    await getReport(database.app);
    await getReport(database.app);

    expect((await request(database.app).get('/api/products')).body).toEqual(productsBefore);
    expect((await listAllCoupons(database.app)).body).toEqual(couponsBefore);
    expect((await listMyOrders(database.app, 'alice')).body).toEqual(aliceOrdersBefore);
  });

  it('calculates each request afresh, so a checkout placed after a read is counted by the next read', async () => {
    const before = (await getReport(database.app)).body as Report;

    await placeOrder(database.app, 'carol', [['ceramic-mug', 1]]);
    const after = (await getReport(database.app)).body as Report;

    expect(after.orderCount).toBe(before.orderCount + 1);
    expect(after.grossRevenueCents).toBe(before.grossRevenueCents + 1200);
    expect(after.netRevenueCents).toBe(before.netRevenueCents + 1200);
  });
});

describe('the admin report of coupons and milestones', () => {
  const database = useTestDatabase({ coupons: { everyNOrders: 2 } });

  beforeAll(async () => {
    // Order 1: alice, 2 x 2,500 = 5,000. Order 2: bob, 1,800, which reaches milestone 1 and earns bob a coupon.
    await placeOrder(database.app, 'alice', [['classic-tee', 2]]);
    await placeOrder(database.app, 'bob', [['canvas-tote', 1]]);
    expect((await generateCoupon(database.app)).status).toBe(201);

    // Order 3: bob redeems his coupon on a 950 notebook set. 10 per cent is 95, so the total is 855.
    const bobCart = await createCart(database.app, 'bob');
    expect((await setLine(database.app, 'bob', bobCart, 'notebook-set', 1)).status).toBe(200);
    const { coupons } = (await listMyCoupons(database.app, 'bob')).body as { coupons: Coupon[] };
    const redeemed = await checkOut(database.app, 'bob', bobCart, undefined, undefined, coupons[0]!.code);
    expect(redeemed.status).toBe(201);

    // Order 4: carol, 1,200, which reaches milestone 2. Nothing has been generated for it yet.
    await placeOrder(database.app, 'carol', [['ceramic-mug', 1]]);
  });

  it('takes the coupon discount off the gross revenue, so net revenue is gross less discounts', async () => {
    const response = await getReport(database.app);

    expect(response.body as Report).toMatchObject({
      orderCount: 4,
      grossRevenueCents: 8950,
      discountCents: 95,
      netRevenueCents: 8855,
    });
  });

  it('counts coupons generated, redeemed and available, and a reached milestone without a coupon as unrewarded', async () => {
    const response = await getReport(database.app);

    expect(response.body as Report).toMatchObject({
      couponsGenerated: 1,
      couponsRedeemed: 1,
      couponsAvailable: 0,
      unrewardedMilestones: 1,
    });
  });

  it('counts a coupon that is generated but not yet redeemed as available, and a generated coupon as rewarding its milestone', async () => {
    expect((await generateCoupon(database.app)).status).toBe(201);

    const response = await getReport(database.app);

    expect(response.body as Report).toMatchObject({
      couponsGenerated: 2,
      couponsRedeemed: 1,
      couponsAvailable: 1,
      unrewardedMilestones: 0,
    });
  });
});
