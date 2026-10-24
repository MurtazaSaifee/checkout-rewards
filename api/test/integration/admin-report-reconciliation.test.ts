import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { useTestDatabase } from '../helpers/test-database.js';
import { getReport, listAllOrders } from '../helpers/admin-api.js';
import { createCart, setLine, viewCart } from '../helpers/cart-api.js';
import { checkOut, placeOrder } from '../helpers/checkout-api.js';
import { generateCoupon, listAllCoupons } from '../helpers/coupon-api.js';
import type {
  AdminCoupon,
  AdminOrder,
  Cart,
  GeneratedCoupon,
  Order,
  Problem,
  Report,
  UnitsSold,
} from '../helpers/api-types.js';

/** Milestone frequency for this file: every third order reaches a milestone. */
const EVERY_N_ORDERS = 3;

/** A checkout answer as the scenario keeps it: the status, and the body the server sent. */
interface Answer {
  status: number;
  body: Partial<Order & Problem> & { currentTotalCents?: number };
}

async function answerOf(response: Promise<request.Response>): Promise<Answer> {
  const sent = await response;
  return { status: sent.status, body: sent.body as Answer['body'] };
}

/** Sets each line in a new cart for the customer, and returns the cart's identifier. */
async function cartWith(
  app: Express,
  customerId: string,
  lines: ReadonlyArray<readonly [string, number]>,
): Promise<string> {
  const cartId = await createCart(app, customerId);
  for (const [productId, quantity] of lines) {
    expect((await setLine(app, customerId, cartId, productId, quantity)).status).toBe(200);
  }
  return cartId;
}

/** Issues the coupon for the oldest unrewarded milestone, which must exist. */
async function generateOne(app: Express): Promise<GeneratedCoupon> {
  const response = await generateCoupon(app);
  expect(response.status).toBe(201);
  return response.body as GeneratedCoupon;
}

/** Checks a cart out sending the total the customer saw. */
function checkOutAt(
  app: Express,
  customerId: string,
  cartId: string,
  expectedTotalCents: number,
  idempotencyKey: string = randomUUID(),
): Promise<request.Response> {
  return Promise.resolve(
    request(app)
      .post(`/api/carts/${cartId}/checkout`)
      .set('X-Customer-Id', customerId)
      .set('Idempotency-Key', idempotencyKey)
      .send({ expectedTotalCents }),
  );
}

/** The answers the scenario gathers, one per checkout or generate call that the assertions examine. */
interface Scenario {
  generateRefused: number;
  redeemFirst: Answer;
  redeemSecond: [Answer, Answer];
  hoodies: Answer[];
  wes: Answer;
  declined: Answer;
  approvedAfterDecline: Answer;
  stale: Answer;
  current: Answer;
}

/** Units per product, summed from the order lines, in product identifier order. */
function unitsFromOrders(orders: readonly AdminOrder[]): UnitsSold[] {
  const totals = new Map<string, UnitsSold>();
  for (const order of orders) {
    for (const line of order.lines) {
      const entry = totals.get(line.productId) ?? { productId: line.productId, name: line.name, quantity: 0 };
      entry.quantity += line.quantity;
      totals.set(line.productId, entry);
    }
  }
  return [...totals.values()].sort((a, b) => (a.productId < b.productId ? -1 : 1));
}

function sumOf<T>(items: readonly T[], value: (item: T) => number): number {
  return items.reduce((sum, item) => sum + value(item), 0);
}

/** The report, the order list and the coupon list, read through the API. Nothing else is consulted. */
async function readAdminViews(app: Express): Promise<{ report: Report; orders: AdminOrder[]; coupons: AdminCoupon[] }> {
  const report = (await getReport(app)).body as Report;
  const orders = ((await listAllOrders(app)).body as { orders: AdminOrder[] }).orders;
  const coupons = ((await listAllCoupons(app)).body as { coupons: AdminCoupon[] }).coupons;
  return { report, orders, coupons };
}

/**
 * Concurrency case 6. A realistic mix of checkouts is built through the API: ordinary
 * checkouts at the same moment, coupon redemptions (one of two racing carts is refused),
 * scarce stock raced by four customers, a declined payment that succeeds on retry, and a
 * price change that refuses a stale total. Then the report is reconciled against the
 * administrator's order and coupon lists only.
 */
describe('the admin report after a mix of successful and refused checkouts', () => {
  const database = useTestDatabase({ coupons: { everyNOrders: EVERY_N_ORDERS } });
  let app: Express;
  let scenario: Scenario;

  beforeAll(async () => {
    // The helper's own beforeAll has already created the app by the time this one runs.
    app = database.app;

    // Wave one: six ordinary checkouts at the same moment, with no coupons yet.
    const ordinary: ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, number]>]> = [
      ['mia', [['classic-tee', 1], ['notebook-set', 2]]],
      ['noah', [['ceramic-mug', 2]]],
      ['olivia', [['canvas-tote', 1], ['enamel-bottle', 1]]],
      ['pete', [['classic-tee', 3]]],
      ['quinn', [['notebook-set', 1]]],
      ['rosa', [['ceramic-mug', 1], ['enamel-bottle', 2]]],
    ];
    await Promise.all(ordinary.map(([customerId, lines]) => placeOrder(app, customerId, lines)));

    // Orders three and six reach milestones one and two, so two coupons are generated, and a third attempt is refused.
    const first = await generateOne(app);
    const second = await generateOne(app);
    const generateRefused = (await generateCoupon(app)).status;

    // Wave two: the two coupon holders redeem, one of them through two carts at once; four customers race
    // for the three hoodies in stock; and one ordinary checkout runs alongside.
    const firstCart = await cartWith(app, first.customerId, [['notebook-set', 1]]);
    const secondCartOne = await cartWith(app, second.customerId, [['enamel-bottle', 1]]);
    const secondCartTwo = await cartWith(app, second.customerId, [['enamel-bottle', 1]]);
    const hoodieCarts = await Promise.all(
      ['stella', 'tomas', 'una', 'vera'].map(async (customerId) => ({
        customerId,
        cartId: await cartWith(app, customerId, [['limited-hoodie', 1]]),
      })),
    );
    const wesCart = await cartWith(app, 'wes', [['canvas-tote', 2]]);

    const [redeemFirst, redeemSecondOne, redeemSecondTwo, wes, ...hoodies] = await Promise.all([
      answerOf(checkOut(app, first.customerId, firstCart, undefined, undefined, first.coupon.code)),
      answerOf(checkOut(app, second.customerId, secondCartOne, undefined, undefined, second.coupon.code)),
      answerOf(checkOut(app, second.customerId, secondCartTwo, undefined, undefined, second.coupon.code)),
      answerOf(checkOut(app, 'wes', wesCart)),
      ...hoodieCarts.map(({ customerId, cartId }) => answerOf(checkOut(app, customerId, cartId))),
    ]);

    // Wave three, one step at a time. Twelve orders have been placed, so milestones three and four are open.
    const third = await generateOne(app);
    const fourth = await generateOne(app);

    // A declined payment places nothing. The same cart then checks out with the approved payment, and redeems the coupon.
    const thirdCart = await cartWith(app, third.customerId, [['classic-tee', 1]]);
    const declined = await answerOf(checkOut(app, third.customerId, thirdCart, undefined, 'tok_decline', third.coupon.code));
    const approvedAfterDecline = await answerOf(
      checkOut(app, third.customerId, thirdCart, undefined, 'tok_ok', third.coupon.code),
    );

    // The price of a bottle changes after the customer has seen the cart. The stale total is refused, and the new total is placed.
    const yaraCart = await cartWith(app, 'yara', [['enamel-bottle', 1]]);
    const seen = (await viewCart(app, 'yara', yaraCart)).body as Cart;
    await database.pool.query("UPDATE products SET unit_price_cents = 1700 WHERE id = 'enamel-bottle'");
    const stale = await answerOf(checkOutAt(app, 'yara', yaraCart, seen.subtotalCents, 'yara-stale'));
    const current = await answerOf(checkOutAt(app, 'yara', yaraCart, 1700, 'yara-current'));

    // The fourth coupon is left unredeemed, so it stays available.
    expect(fourth.coupon.redeemed).toBe(false);

    scenario = {
      generateRefused,
      redeemFirst,
      redeemSecond: [redeemSecondOne, redeemSecondTwo],
      hoodies,
      wes,
      declined,
      approvedAfterDecline,
      stale,
      current,
    };
  });

  it('answers each checkout with the outcome its situation calls for', () => {
    expect(scenario.generateRefused).toBe(409);
    expect(scenario.redeemFirst).toMatchObject({ status: 201 });
    expect(scenario.redeemSecond.map((item) => item.status).sort()).toEqual([201, 422]);
    const refusedRedemption = scenario.redeemSecond.find((item) => item.status === 422);
    expect(refusedRedemption?.body).toMatchObject({ code: 'COUPON_ALREADY_REDEEMED' });
    expect(scenario.hoodies.map((item) => item.status).sort()).toEqual([201, 201, 201, 409]);
    const refusedHoodie = scenario.hoodies.find((item) => item.status === 409);
    expect(refusedHoodie?.body).toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    expect(scenario.wes).toMatchObject({ status: 201 });
    expect(scenario.declined).toMatchObject({ status: 402, body: { code: 'PAYMENT_DECLINED' } });
    expect(scenario.approvedAfterDecline).toMatchObject({ status: 201 });
    expect(scenario.stale).toMatchObject({ status: 409, body: { code: 'PRICE_CHANGED', currentTotalCents: 1700 } });
    expect(scenario.current).toMatchObject({ status: 201 });
  });

  it('counts every placed order, gapless from one, and the order count equals the highest order number', async () => {
    const { report, orders } = await readAdminViews(app);
    const numbers = orders.map((order) => order.orderNumber);

    expect(numbers).toEqual(Array.from({ length: orders.length }, (_, index) => index + 1));
    expect(report.orderCount).toBe(Math.max(...numbers));
    expect(report.orderCount).toBe(14);
  });

  it('reconciles gross revenue, discounts and net revenue with the sums over the order list', async () => {
    const { report, orders } = await readAdminViews(app);

    expect(report).toMatchObject({
      grossRevenueCents: sumOf(orders, (order) => order.subtotalCents),
      discountCents: sumOf(orders, (order) => order.discountCents),
      netRevenueCents: sumOf(orders, (order) => order.totalCents),
    });
    expect(report.netRevenueCents).toBe(report.grossRevenueCents - report.discountCents);
    for (const order of orders) {
      const expectedDiscount =
        order.couponPercentOff === null ? 0 : Math.floor((order.subtotalCents * order.couponPercentOff) / 100);
      expect(order.discountCents).toBe(expectedDiscount);
      expect(order.totalCents).toBe(order.subtotalCents - order.discountCents);
    }
  });

  it('reconciles units sold by product with the lines of every order', async () => {
    const { report, orders } = await readAdminViews(app);

    expect(report.unitsSold).toEqual(unitsFromOrders(orders));
    expect(report.unitsSold.find((units) => units.productId === 'limited-hoodie')?.quantity).toBe(3);
  });

  it('reconciles coupon counts with the coupon list, and each redeemed coupon with the order that redeemed it', async () => {
    const { report, orders, coupons } = await readAdminViews(app);
    const redeemed = coupons.filter((coupon) => coupon.redeemedByOrderId !== null);

    expect(report).toMatchObject({
      couponsGenerated: coupons.length,
      couponsRedeemed: redeemed.length,
      couponsAvailable: coupons.length - redeemed.length,
    });
    expect(report.couponsRedeemed).toBe(3);
    expect(report.couponsAvailable).toBe(1);
    for (const coupon of redeemed) {
      const order = orders.find((candidate) => candidate.id === coupon.redeemedByOrderId);
      expect(order?.couponCode).toBe(coupon.code);
    }
    expect(orders.filter((order) => order.couponCode !== null)).toHaveLength(redeemed.length);
  });

  it('reconciles unrewarded milestones with the milestones reached, and each coupon with the order that earned it', async () => {
    const { report, orders, coupons } = await readAdminViews(app);

    expect(report.unrewardedMilestones).toBe(Math.floor(orders.length / EVERY_N_ORDERS) - coupons.length);
    expect(report.unrewardedMilestones).toBe(0);
    for (const coupon of coupons) {
      const milestoneOrder = orders.find((order) => order.orderNumber === coupon.milestone * EVERY_N_ORDERS);
      expect(milestoneOrder?.customerId).toBe(coupon.customerId);
    }
  });
});
