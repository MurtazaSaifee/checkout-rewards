import { beforeAll, describe, expect, it } from 'vitest';
import { useTestDatabase } from '../helpers/test-database.js';
import { listAllOrders } from '../helpers/admin-api.js';
import { checkOut, placeOrder } from '../helpers/checkout-api.js';
import { createCart, setLine } from '../helpers/cart-api.js';
import { generateCoupon, listMyCoupons } from '../helpers/coupon-api.js';
import type { AdminOrder, Coupon, Problem } from '../helpers/api-types.js';

describe('the admin key on the order list', () => {
  const database = useTestDatabase();

  it.each([
    ['without the admin key', null],
    ['with a wrong admin key', 'not-the-admin-key'],
  ])('answers the order list %s with 401 ADMIN_KEY_INVALID', async (_label, key) => {
    const response = await listAllOrders(database.app, key);

    expect(response.status).toBe(401);
    expect(response.body as Problem).toMatchObject({ status: 401, code: 'ADMIN_KEY_INVALID' });
  });
});

describe('listing every order as the administrator', () => {
  const database = useTestDatabase({ coupons: { everyNOrders: 2 } });

  beforeAll(async () => {
    // Order 1: alice, 2 x 2,500 = 5,000, with no coupon.
    await placeOrder(database.app, 'alice', [['classic-tee', 2]]);
    // Order 2: bob, 1,800 + 1,200 = 3,000, which reaches milestone 1 and earns bob a coupon.
    await placeOrder(database.app, 'bob', [
      ['canvas-tote', 1],
      ['ceramic-mug', 1],
    ]);
    expect((await generateCoupon(database.app)).status).toBe(201);

    // Order 3: bob redeems his coupon on a 950 notebook set. 10 per cent is 95, so the total is 855.
    const cart = await createCart(database.app, 'bob');
    expect((await setLine(database.app, 'bob', cart, 'notebook-set', 1)).status).toBe(200);
    const { coupons } = (await listMyCoupons(database.app, 'bob')).body as { coupons: Coupon[] };
    expect((await checkOut(database.app, 'bob', cart, undefined, undefined, coupons[0]!.code)).status).toBe(201);
  });

  it('lists every order in order-number order, each with its customer, lines and totals', async () => {
    const response = await listAllOrders(database.app);

    expect(response.status).toBe(200);
    const { orders } = response.body as { orders: AdminOrder[] };
    expect(orders).toMatchObject([
      {
        orderNumber: 1,
        customerId: 'alice',
        lines: [{ productId: 'classic-tee', name: 'Classic Cotton Tee', unitPriceCents: 2500, quantity: 2, lineAmountCents: 5000 }],
        subtotalCents: 5000,
        couponCode: null,
        couponPercentOff: null,
        discountCents: 0,
        totalCents: 5000,
      },
      {
        orderNumber: 2,
        customerId: 'bob',
        lines: [
          { productId: 'canvas-tote', quantity: 1, lineAmountCents: 1800 },
          { productId: 'ceramic-mug', quantity: 1, lineAmountCents: 1200 },
        ],
        subtotalCents: 3000,
        couponCode: null,
        discountCents: 0,
        totalCents: 3000,
      },
      {
        orderNumber: 3,
        customerId: 'bob',
        lines: [{ productId: 'notebook-set', name: 'Notebook Set', unitPriceCents: 950, quantity: 1, lineAmountCents: 950 }],
        subtotalCents: 950,
        couponPercentOff: 10,
        discountCents: 95,
        totalCents: 855,
      },
    ]);
    for (const order of orders) {
      expect(Date.parse(order.placedAt)).not.toBeNaN();
    }
  });
});

describe('listing orders of a store with none placed', () => {
  const database = useTestDatabase();

  it('answers an empty list, not an error', async () => {
    const response = await listAllOrders(database.app);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ orders: [] });
  });
});
