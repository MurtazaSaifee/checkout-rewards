import { useState } from 'react';
import type { CustomerId } from './customer';
import type { Outcome } from './outcomes';
import { clampCount, fireCheckouts, prepareCarts, RaceTables } from './raceCheckouts';

/** The product seeded with three units, so a race over it has winners and losers. */
const SCARCE_PRODUCT = 'limited-hoodie';
const MIN_CHECKOUTS = 2;
const MAX_CHECKOUTS = 50;
const DEFAULT_CHECKOUTS = 8;

interface RaceResult {
  checkouts: number;
  /** Carts whose one-unit line was refused before checkout, so they never checked out. */
  setup: Outcome[];
  outcomes: Outcome[];
}

type Phase = { kind: 'idle' } | { kind: 'running' } | { kind: 'done'; result: RaceResult };

export function RaceTool({ customer, onFinished }: { customer: CustomerId; onFinished: () => void }) {
  const [input, setInput] = useState(String(DEFAULT_CHECKOUTS));
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  async function race(): Promise<void> {
    const checkouts = clampCount(input, {
      min: MIN_CHECKOUTS,
      max: MAX_CHECKOUTS,
      fallback: DEFAULT_CHECKOUTS,
    });
    setPhase({ kind: 'running' });

    // Fresh carts, one unit of the scarce product each. The carts are not remembered,
    // so the customer's own cart is never touched.
    const { cartIds, setup } = await prepareCarts(customer, SCARCE_PRODUCT, checkouts);
    const outcomes = await fireCheckouts(customer, cartIds);

    setPhase({ kind: 'done', result: { checkouts, setup, outcomes } });
    onFinished();
  }

  return (
    <section aria-labelledby="race-heading">
      <h2 id="race-heading">Race: simultaneous checkouts</h2>
      <p>
        Creates fresh carts with one unit of <code>{SCARCE_PRODUCT}</code> each, then starts every
        checkout at the same moment. Your own cart is not changed.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void race();
        }}
      >
        <label>
          Checkouts{' '}
          <input
            type="number"
            min={MIN_CHECKOUTS}
            max={MAX_CHECKOUTS}
            value={input}
            size={4}
            onChange={(event) => {
              setInput(event.target.value);
            }}
          />
        </label>{' '}
        <button type="submit" disabled={phase.kind === 'running'}>
          {phase.kind === 'running' ? 'Racing…' : 'Fire checkouts'}
        </button>
      </form>

      {phase.kind === 'done' ? <RaceSummary result={phase.result} /> : null}
    </section>
  );
}

function RaceSummary({ result }: { result: RaceResult }) {
  const placedCount = result.outcomes.filter((outcome) => outcome.placed).length;

  return (
    <>
      <p>
        {result.checkouts} checkouts fired: <strong>{placedCount} placed</strong>,{' '}
        {result.outcomes.length - placedCount} refused or not completed.
        {result.setup.length > 0
          ? ` ${result.setup.length} carts were refused before checkout, so they were not checked out.`
          : ''}
      </p>
      <RaceTables setup={result.setup} outcomes={result.outcomes} />
    </>
  );
}
