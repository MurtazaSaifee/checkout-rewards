import { describe, expect, it } from 'vitest';
import { lineAmountCents, subtotalCents } from '../../src/modules/pricing/pricing.js';

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
