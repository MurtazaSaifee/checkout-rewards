import { describe, expect, it } from 'vitest';
import {
  discountCents,
  lineAmountCents,
  milestonesReached,
  priceOrder,
  subtotalCents,
  unrewardedMilestones,
} from '../../src/modules/pricing/pricing.js';

describe('lineAmountCents', () => {
  it('multiplies the unit price in cents by the quantity', () => {
    expect(lineAmountCents({ unitPriceCents: 1200, quantity: 3 })).toBe(3600);
  });
});

describe('subtotalCents', () => {
  it('is zero for an empty cart', () => {
    expect(subtotalCents([])).toBe(0);
  });

  it('is the line amount of a single-line cart', () => {
    expect(subtotalCents([{ unitPriceCents: 2500, quantity: 2 }])).toBe(5000);
  });

  it('sums the line amounts of a multi-line cart', () => {
    expect(
      subtotalCents([
        { unitPriceCents: 2500, quantity: 2 },
        { unitPriceCents: 950, quantity: 1 },
        { unitPriceCents: 8999, quantity: 3 },
      ]),
    ).toBe(5000 + 950 + 26997);
  });
});

describe('milestonesReached', () => {
  it('is zero until the order count reaches n', () => {
    expect(milestonesReached(0, 5)).toBe(0);
    expect(milestonesReached(4, 5)).toBe(0);
  });

  it('counts each full run of n orders', () => {
    expect(milestonesReached(5, 5)).toBe(1);
    expect(milestonesReached(9, 5)).toBe(1);
    expect(milestonesReached(10, 5)).toBe(2);
    expect(milestonesReached(14, 5)).toBe(2);
  });

  it('counts every order when n is 1', () => {
    expect(milestonesReached(7, 1)).toBe(7);
  });

  it('rounds down for any n', () => {
    expect(milestonesReached(4, 2)).toBe(2);
    expect(milestonesReached(5, 2)).toBe(2);
  });
});

describe('unrewardedMilestones', () => {
  it('is the milestones reached less the coupons already issued', () => {
    expect(unrewardedMilestones(10, 0, 5)).toBe(2);
    expect(unrewardedMilestones(10, 1, 5)).toBe(1);
    expect(unrewardedMilestones(10, 2, 5)).toBe(0);
  });

  it('is zero before the first milestone is reached', () => {
    expect(unrewardedMilestones(4, 0, 5)).toBe(0);
  });

  it('counts a new milestone as soon as its order is placed', () => {
    expect(unrewardedMilestones(5, 0, 5)).toBe(1);
    expect(unrewardedMilestones(6, 1, 5)).toBe(0);
  });
});

describe('discountCents', () => {
  it('rounds the discount down at a half-cent boundary: 10% of 1,995 cents is 199 cents', () => {
    expect(discountCents(1995, 10)).toBe(199);
  });

  it('rounds the discount down rather than to the nearest cent: 10% of 8,999 cents is 899 cents', () => {
    expect(discountCents(8999, 10)).toBe(899);
  });

  it('takes exactly the percentage when it divides the subtotal evenly', () => {
    expect(discountCents(2500, 10)).toBe(250);
  });

  it('rounds a discount smaller than one cent down to zero', () => {
    expect(discountCents(99, 1)).toBe(0);
  });

  it('takes the whole subtotal at 100 percent', () => {
    expect(discountCents(1995, 100)).toBe(1995);
  });

  it('takes nothing for a 1-cent subtotal at 10 percent, and the whole cent at 100 percent', () => {
    expect(discountCents(1, 10)).toBe(0);
    expect(discountCents(1, 100)).toBe(1);
  });

  it('takes nothing at 0 percent', () => {
    expect(discountCents(1995, 0)).toBe(0);
  });

  it('refuses a percentage outside 0 to 100, or one that is not whole', () => {
    expect(() => discountCents(1995, 101)).toThrow(RangeError);
    expect(() => discountCents(1995, -1)).toThrow(RangeError);
    expect(() => discountCents(1995, 10.5)).toThrow(RangeError);
  });
});

describe('priceOrder', () => {
  it('charges the subtotal with no discount when there is no coupon', () => {
    expect(
      priceOrder([
        { unitPriceCents: 2500, quantity: 2 },
        { unitPriceCents: 950, quantity: 1 },
      ]),
    ).toEqual({ subtotalCents: 5950, discountCents: 0, totalCents: 5950 });
  });

  it('applies the percentage once to the subtotal, not to each line', () => {
    // Per line, 10% of each 995 would round to 99 twice, which is 198. Once on the subtotal it is 199.
    expect(
      priceOrder(
        [
          { unitPriceCents: 995, quantity: 1 },
          { unitPriceCents: 995, quantity: 1 },
        ],
        10,
      ),
    ).toEqual({ subtotalCents: 1990, discountCents: 199, totalCents: 1791 });
  });

  it('prices a multi-line cart on its subtotal', () => {
    expect(
      priceOrder(
        [
          { unitPriceCents: 2500, quantity: 2 },
          { unitPriceCents: 950, quantity: 1 },
          { unitPriceCents: 8999, quantity: 3 },
        ],
        10,
      ),
    ).toEqual({ subtotalCents: 32947, discountCents: 3294, totalCents: 29653 });
  });

  it('gives a zero total at 100 percent off', () => {
    expect(priceOrder([{ unitPriceCents: 1200, quantity: 1 }], 100)).toEqual({
      subtotalCents: 1200,
      discountCents: 1200,
      totalCents: 0,
    });
  });

  it('prices a 1-cent subtotal, which takes no discount at 10 percent', () => {
    expect(priceOrder([{ unitPriceCents: 1, quantity: 1 }], 10)).toEqual({
      subtotalCents: 1,
      discountCents: 0,
      totalCents: 1,
    });
  });

  it('prices an empty cart at zero, with or without a coupon', () => {
    expect(priceOrder([])).toEqual({ subtotalCents: 0, discountCents: 0, totalCents: 0 });
    expect(priceOrder([], 10)).toEqual({ subtotalCents: 0, discountCents: 0, totalCents: 0 });
  });

  it('never charges a negative total, and always accounts for the whole subtotal', () => {
    for (const percentOff of [0, 1, 10, 33, 50, 99, 100]) {
      for (const quantity of [1, 2, 3, 7, 99]) {
        const priced = priceOrder([{ unitPriceCents: 8999, quantity }], percentOff);

        expect(priced.totalCents).toBeGreaterThanOrEqual(0);
        expect(priced.discountCents + priced.totalCents).toBe(priced.subtotalCents);
      }
    }
  });
});
