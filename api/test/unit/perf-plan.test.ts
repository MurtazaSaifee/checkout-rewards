import { describe, expect, it } from 'vitest';
import { spreadCheckouts } from '../../perf/plan.js';

describe('spreadCheckouts', () => {
  it('takes one unit per checkout, round-robin across the products', () => {
    expect(
      spreadCheckouts(
        [
          { id: 'a', stock: 2 },
          { id: 'b', stock: 2 },
        ],
        4,
      ),
    ).toEqual(['a', 'b', 'a', 'b']);
  });

  it('never picks a product more often than its stock, and stops when the stock is gone', () => {
    expect(
      spreadCheckouts(
        [
          { id: 'a', stock: 1 },
          { id: 'b', stock: 3 },
        ],
        10,
      ),
    ).toEqual(['a', 'b', 'b', 'b']);
  });
});
