import { describe, expect, it } from 'vitest';
import { type PlacedOrders, type StoreSnapshot, reconcile } from '../../perf/reconcile.js';

/**
 * A run in which two orders were placed, one for a ceramic mug and one for the
 * hoodie, with no coupon. The figures are worked by hand, not computed by the
 * code under test, so they are an independent source of truth.
 */
const before: StoreSnapshot = {
  stock: { 'ceramic-mug': 60, 'limited-hoodie': 3 },
  report: {
    orderCount: 4,
    grossRevenueCents: 5000,
    discountCents: 500,
    netRevenueCents: 4500,
    unitsSold: [{ productId: 'ceramic-mug', quantity: 4 }],
  },
};

const placed: PlacedOrders = {
  count: 2,
  subtotalCents: 10199,
  discountCents: 0,
  totalCents: 10199,
  unitsByProduct: { 'ceramic-mug': 1, 'limited-hoodie': 1 },
};

const after: StoreSnapshot = {
  stock: { 'ceramic-mug': 59, 'limited-hoodie': 2 },
  report: {
    orderCount: 6,
    grossRevenueCents: 15199,
    discountCents: 500,
    netRevenueCents: 14699,
    unitsSold: [
      { productId: 'ceramic-mug', quantity: 5 },
      { productId: 'limited-hoodie', quantity: 1 },
    ],
  },
};

function run(overrides: { after?: StoreSnapshot; placed?: PlacedOrders; expectedPlaced?: number; serverErrors?: number } = {}) {
  return reconcile({
    before,
    after: overrides.after ?? after,
    placed: overrides.placed ?? placed,
    expectedPlaced: overrides.expectedPlaced ?? 2,
    serverErrors: overrides.serverErrors ?? 0,
  });
}

function checkNamed(checks: ReturnType<typeof run>, name: string) {
  const check = checks.find((candidate) => candidate.name === name);
  if (check === undefined) throw new Error(`no check named ${name}`);
  return check;
}

describe('reconcile', () => {
  it('fails the check when stock has gone negative', () => {
    const negative: StoreSnapshot = { ...after, stock: { ...after.stock, 'limited-hoodie': -1 } };

    expect(checkNamed(run({ after: negative }), 'stock is never negative').passed).toBe(false);
  });

  it('fails the check when the order count did not rise by the placed orders', () => {
    const miscounted: StoreSnapshot = { ...after, report: { ...after.report, orderCount: 5 } };

    expect(checkNamed(run({ after: miscounted }), 'order count rose by the placed orders').passed).toBe(false);
  });

  it('fails the check when fewer checkouts were placed than the stock allowed', () => {
    expect(checkNamed(run({ expectedPlaced: 3 }), 'every expected checkout was placed').passed).toBe(false);
  });

  it('fails the check when stock fell by other than the units on the placed orders', () => {
    const oversold: StoreSnapshot = { ...after, stock: { ...after.stock, 'ceramic-mug': 58 } };

    expect(checkNamed(run({ after: oversold }), 'stock fell by the units on the placed orders').passed).toBe(false);
  });

  it('fails the check when the report moved by other than the placed orders', () => {
    const understated: StoreSnapshot = {
      ...after,
      report: { ...after.report, grossRevenueCents: 15000, netRevenueCents: 14500 },
    };

    expect(
      checkNamed(run({ after: understated }), 'report gross, discount and net moved by the placed orders').passed,
    ).toBe(false);
  });

  it('fails the check when net revenue is not gross revenue less discounts', () => {
    const unbalanced: StoreSnapshot = { ...after, report: { ...after.report, netRevenueCents: 14000 } };

    expect(checkNamed(run({ after: unbalanced }), 'net revenue equals gross revenue less discounts').passed).toBe(false);
  });

  it('fails the check when the report sold other than the placed units', () => {
    const unsold: StoreSnapshot = {
      ...after,
      report: { ...after.report, unitsSold: [{ productId: 'ceramic-mug', quantity: 4 }, { productId: 'limited-hoodie', quantity: 1 }] },
    };

    expect(checkNamed(run({ after: unsold }), 'report units sold rose by the placed units').passed).toBe(false);
  });

  it('fails the check when the run saw a server error', () => {
    expect(checkNamed(run({ serverErrors: 1 }), 'no server errors (5xx)').passed).toBe(false);
  });

  it('passes every check for a run that reconciles', () => {
    const checks = run();

    expect(checks.filter((check) => !check.passed).map((check) => check.name)).toEqual([]);
  });
});
