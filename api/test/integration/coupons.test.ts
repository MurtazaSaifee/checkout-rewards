import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { useTestDatabase } from '../helpers/test-database.js';
import { generateCoupon, listAllCoupons, listMyCoupons } from '../helpers/coupon-api.js';
import { placeOrder } from '../helpers/checkout-api.js';
import type { AdminCoupon, GeneratedCoupon, Problem } from '../helpers/api-types.js';

/** Ten characters from the alphabet without the easily confused 0, O, 1, I and L. */
const COUPON_CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/;

/** Every order in these tests buys one mug, which always has stock. */
const MUG: ReadonlyArray<readonly [string, number]> = [['ceramic-mug', 1]];

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

describe('generating a coupon', () => {
  const database = useTestDatabase({ coupons: { everyNOrders: 2 } });

  it('refuses to generate until an order has reached the first milestone, with 409 NO_ELIGIBLE_MILESTONE', async () => {
    const none = await generateCoupon(database.app);
    expect(none.status).toBe(409);
    expect(none.body).toMatchObject({ status: 409, code: 'NO_ELIGIBLE_MILESTONE' });

    // Order 1 is not a milestone when n is 2.
    await placeOrder(database.app, 'alice', MUG);
    const one = await generateCoupon(database.app);
    expect(one.status).toBe(409);
    expect(one.body).toMatchObject({ code: 'NO_ELIGIBLE_MILESTONE' });
  });

  it('issues milestone 1 to the customer who placed order 2, at the configured percentage, and returns 201', async () => {
    await placeOrder(database.app, 'bob', MUG);

    const response = await generateCoupon(database.app);

    expect(response.status).toBe(201);
    const body = response.body as GeneratedCoupon;
    expect(body.coupon.code).toMatch(COUPON_CODE);
    expect(body).toEqual({
      coupon: { code: body.coupon.code, percentOff: 10, milestone: 1, redeemed: false },
      customerId: 'bob',
      unrewardedMilestonesRemaining: 0,
    });
  });

  it('refuses another coupon until the next milestone is reached, then issues milestone 2 to the customer of order 4', async () => {
    const again = await generateCoupon(database.app);
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: 'NO_ELIGIBLE_MILESTONE' });

    await placeOrder(database.app, 'carol', MUG);
    expect((await generateCoupon(database.app)).status).toBe(409);
    await placeOrder(database.app, 'carol', MUG);

    const second = await generateCoupon(database.app);
    expect(second.status).toBe(201);
    expect(second.body).toMatchObject({
      coupon: { milestone: 2, percentOff: 10 },
      customerId: 'carol',
      unrewardedMilestonesRemaining: 0,
    });
  });
});

describe('counting unrewarded milestones', () => {
  const database = useTestDatabase({ coupons: { everyNOrders: 2 } });

  it('reports how many unrewarded milestones remain after each coupon, and refuses once none are left', async () => {
    for (const customerId of ['alice', 'bob', 'carol', 'dave']) {
      await placeOrder(database.app, customerId, MUG);
    }

    const first = await generateCoupon(database.app);
    const second = await generateCoupon(database.app);
    const third = await generateCoupon(database.app);

    expect(first.body).toMatchObject({ coupon: { milestone: 1 }, customerId: 'bob', unrewardedMilestonesRemaining: 1 });
    expect(second.body).toMatchObject({ coupon: { milestone: 2 }, customerId: 'dave', unrewardedMilestonesRemaining: 0 });
    expect(third.status).toBe(409);
    expect(third.body).toMatchObject({ code: 'NO_ELIGIBLE_MILESTONE' });
  });
});

describe('my coupons', () => {
  const database = useTestDatabase({ coupons: { everyNOrders: 2 } });
  let issued: GeneratedCoupon[] = [];

  beforeAll(async () => {
    // Alice placed orders 2 and 4, so she holds milestones 1 and 2. Bob and Carol placed none.
    await placeOrder(database.app, 'bob', MUG);
    await placeOrder(database.app, 'alice', MUG);
    await placeOrder(database.app, 'carol', MUG);
    await placeOrder(database.app, 'alice', MUG);
    issued = [
      (await generateCoupon(database.app)).body as GeneratedCoupon,
      (await generateCoupon(database.app)).body as GeneratedCoupon,
    ];
  });

  it('lists every coupon a customer holds, in milestone order, unredeemed', async () => {
    const response = await listMyCoupons(database.app, 'alice');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      coupons: [
        { code: issued[0]!.coupon.code, percentOff: 10, milestone: 1, redeemed: false },
        { code: issued[1]!.coupon.code, percentOff: 10, milestone: 2, redeemed: false },
      ],
    });
  });

  it("never lists another customer's coupons", async () => {
    const bob = await listMyCoupons(database.app, 'bob');
    const carol = await listMyCoupons(database.app, 'carol');

    expect(bob.body).toEqual({ coupons: [] });
    expect(carol.body).toEqual({ coupons: [] });
  });

  it('requires the customer identifier, with 400 CUSTOMER_ID_REQUIRED', async () => {
    const response = await request(database.app).get('/api/coupons');

    expect(response.status).toBe(400);
    expect(response.body as Problem).toMatchObject({ status: 400, code: 'CUSTOMER_ID_REQUIRED' });
  });
});

describe('all coupons for the administrator', () => {
  const database = useTestDatabase({ coupons: { everyNOrders: 2 } });

  beforeAll(async () => {
    await placeOrder(database.app, 'bob', MUG);
    await placeOrder(database.app, 'alice', MUG);
    await placeOrder(database.app, 'carol', MUG);
    await placeOrder(database.app, 'dave', MUG);
    await generateCoupon(database.app);
    await generateCoupon(database.app);
  });

  it('lists every coupon with the customer it was issued to, in milestone order', async () => {
    const response = await listAllCoupons(database.app);
    const { coupons } = response.body as { coupons: AdminCoupon[] };

    expect(response.status).toBe(200);
    expect(coupons).toHaveLength(2);
    const [first, second] = coupons as [AdminCoupon, AdminCoupon];
    for (const coupon of [first, second]) {
      expect(coupon.code).toMatch(COUPON_CODE);
      expect(Date.parse(coupon.issuedAt)).not.toBeNaN();
    }
    expect(first.code).not.toBe(second.code);
    expect(coupons).toMatchObject([
      { percentOff: 10, milestone: 1, customerId: 'alice', redeemedByOrderId: null },
      { percentOff: 10, milestone: 2, customerId: 'dave', redeemedByOrderId: null },
    ]);
  });
});

describe('simultaneous generation', () => {
  const database = useTestDatabase({ coupons: { everyNOrders: 2 } });

  it('issues exactly one coupon per unrewarded milestone and refuses the rest with NO_ELIGIBLE_MILESTONE', async () => {
    // Four orders: milestones 1 (order 2, bob) and 2 (order 4, carol) are unrewarded.
    await placeOrder(database.app, 'alice', MUG);
    await placeOrder(database.app, 'bob', MUG);
    await placeOrder(database.app, 'alice', MUG);
    await placeOrder(database.app, 'carol', MUG);

    const responses = await Promise.all(Array.from({ length: 12 }, () => generateCoupon(database.app)));

    const issued = responses.filter((response) => response.status === 201);
    const refused = responses.filter((response) => response.status === 409);
    expect(issued).toHaveLength(2);
    expect(refused).toHaveLength(10);
    for (const response of refused) {
      expect(response.body).toMatchObject({ code: 'NO_ELIGIBLE_MILESTONE' });
    }

    const issuedBodies = issued.map((response) => response.body as GeneratedCoupon);
    expect(issuedBodies.map((body) => [body.coupon.milestone, body.customerId]).sort()).toEqual([
      [1, 'bob'],
      [2, 'carol'],
    ]);

    const { coupons } = (await listAllCoupons(database.app)).body as { coupons: AdminCoupon[] };
    expect(coupons.map((coupon) => coupon.code).sort()).toEqual(
      issuedBodies.map((body) => body.coupon.code).sort(),
    );
  });
});
