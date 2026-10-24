import { useState } from 'react';
import { type Coupon, listMyCoupons } from './api/client';
import type { CustomerId } from './customer';
import { ErrorDetails } from './ErrorDetails';
import type { Outcome } from './outcomes';
import { clampCount, fireCheckouts, prepareCarts, RaceTables } from './raceCheckouts';

/** A product with plenty of stock, so the carts do not run short and only the coupon decides the race. */
const RACE_PRODUCT = 'notebook-set';
const MIN_CARTS = 2;
const MAX_CARTS = 10;
const DEFAULT_CARTS = 2;

interface CouponRaceResult {
  coupon: Coupon;
  carts: number;
  /** Carts that could not be set up, so they never checked out. */
  setup: Outcome[];
  outcomes: Outcome[];
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'no-coupon' }
  | { kind: 'done'; result: CouponRaceResult }
  | { kind: 'failed'; error: unknown };

/**
 * Redeems one of the customer's coupons from several carts at the same moment. A coupon
 * redeems once, so exactly one of the checkouts should place an order.
 */
export function CouponRaceTool({ customer, onFinished }: { customer: CustomerId; onFinished: () => void }) {
  const [input, setInput] = useState(String(DEFAULT_CARTS));
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  async function race(): Promise<void> {
    setPhase({ kind: 'running' });
    try {
      const { coupons } = await listMyCoupons(customer);
      const coupon = coupons.find((candidate) => !candidate.redeemed);
      if (coupon === undefined) {
        setPhase({ kind: 'no-coupon' });
        return;
      }

      // Fresh carts, one unit of the product each. The customer's own cart is never touched.
      const carts = clampCount(input, { min: MIN_CARTS, max: MAX_CARTS, fallback: DEFAULT_CARTS });
      const { cartIds, setup } = await prepareCarts(customer, RACE_PRODUCT, carts);
      // Every checkout starts in the same moment, each with its own key and the same coupon.
      // No expected total is sent, so the race is decided by the coupon alone.
      const outcomes = await fireCheckouts(customer, cartIds, coupon.code);

      setPhase({ kind: 'done', result: { coupon, carts, setup, outcomes } });
    } catch (error: unknown) {
      setPhase({ kind: 'failed', error });
    }
    onFinished();
  }

  return (
    <section aria-labelledby="coupon-race-heading">
      <h2 id="coupon-race-heading">Race: one coupon, several carts</h2>
      <p>
        Redeems your first unredeemed coupon from several fresh carts, each with one{' '}
        <code>{RACE_PRODUCT}</code>, all checked out at the same moment. A coupon redeems once, so
        exactly one checkout should place an order. This uses the coupon up. Your own cart is not
        changed.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void race();
        }}
      >
        <label>
          Carts{' '}
          <input
            type="number"
            min={MIN_CARTS}
            max={MAX_CARTS}
            value={input}
            size={4}
            onChange={(event) => {
              setInput(event.target.value);
            }}
          />
        </label>{' '}
        <button type="submit" disabled={phase.kind === 'running'}>
          {phase.kind === 'running' ? 'Racing…' : 'Race the coupon'}
        </button>
      </form>

      {phase.kind === 'no-coupon' ? (
        <p>This customer has no unredeemed coupon to race. One is issued for every nth order, once an administrator generates it.</p>
      ) : null}
      {phase.kind === 'done' ? <CouponRaceSummary result={phase.result} /> : null}
      {phase.kind === 'failed' ? <ErrorDetails error={phase.error} /> : null}
    </section>
  );
}

function CouponRaceSummary({ result }: { result: CouponRaceResult }) {
  const placedCount = result.outcomes.filter((outcome) => outcome.placed).length;
  const verdict =
    placedCount === 1
      ? 'Exactly one order was placed, so the coupon was redeemed once.'
      : placedCount === 0
        ? 'No order was placed, so the coupon is still unredeemed.'
        : `${placedCount} orders were placed with this coupon.`;

  return (
    <>
      <p>
        {result.carts} checkouts with coupon <code>{result.coupon.code}</code> ({result.coupon.percentOff}%
        off) fired: <strong>{placedCount} placed</strong>, {result.outcomes.length - placedCount} refused or
        not completed. {verdict}
        {result.setup.length > 0
          ? ` ${result.setup.length} carts were refused before checkout, so they were not checked out.`
          : ''}
      </p>
      <RaceTables setup={result.setup} outcomes={result.outcomes} />
    </>
  );
}
