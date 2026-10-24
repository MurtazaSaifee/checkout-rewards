import { describe, expect, it } from 'vitest';
import {
  isMilestoneOrder,
  lineAmountCents,
  milestonesReached,
  subtotalCents,
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

describe('isMilestoneOrder', () => {
  it('is true for every multiple of n', () => {
    expect(isMilestoneOrder(5, 5)).toBe(true);
    expect(isMilestoneOrder(10, 5)).toBe(true);
    expect(isMilestoneOrder(1, 1)).toBe(true);
  });

  it('is false for the orders between milestones', () => {
    expect(isMilestoneOrder(4, 5)).toBe(false);
    expect(isMilestoneOrder(6, 5)).toBe(false);
  });

  it('is false for zero, which is not an order number', () => {
    expect(isMilestoneOrder(0, 5)).toBe(false);
  });
});
