import { useState } from 'react';
import { checkOutCart, createCart, newIdempotencyKey, setCartLineQuantity } from './api/client';
import type { CustomerId } from './customer';
import { countLabels, type Outcome, placed, refusal } from './outcomes';

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
    const checkouts = clampCheckouts(input);
    setPhase({ kind: 'running' });

    // Fresh carts, one unit of the scarce product each. The carts are not remembered,
    // so the customer's own cart is never touched.
    const prepared = await Promise.allSettled(
      Array.from({ length: checkouts }, () => prepareCart(customer)),
    );
    const cartIds = prepared.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
    const setup = prepared.flatMap((result) =>
      result.status === 'rejected' ? [refusal(result.reason)] : [],
    );

    // Every checkout is started in the same moment, so the server receives them together.
    // Each is a separate attempt, so each has its own key.
    const settled = await Promise.allSettled(
      cartIds.map((cartId) => checkOutCart(customer, cartId, newIdempotencyKey(), 'tok_ok')),
    );
    const outcomes = settled.map((result) =>
      result.status === 'fulfilled' ? placed(result.value) : refusal(result.reason),
    );

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
  const counts = countLabels([...result.setup.map((outcome) => ({ ...outcome, label: `set-up: ${outcome.label}` })), ...result.outcomes]);

  return (
    <>
      <p>
        {result.checkouts} checkouts fired: <strong>{placedCount} placed</strong>,{' '}
        {result.outcomes.length - placedCount} refused or not completed.
        {result.setup.length > 0
          ? ` ${result.setup.length} carts were refused before checkout, so they were not checked out.`
          : ''}
      </p>
      <table>
        <thead>
          <tr>
            <th scope="col">Outcome</th>
            <th scope="col">Count</th>
          </tr>
        </thead>
        <tbody>
          {counts.map(([label, count]) => (
            <tr key={label}>
              <td>{label}</td>
              <td>{count}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table>
        <thead>
          <tr>
            <th scope="col">Stage</th>
            <th scope="col">Outcome</th>
            <th scope="col">Detail</th>
          </tr>
        </thead>
        <tbody>
          {result.setup.map((outcome, index) => (
            <tr key={`set-up-${index}`}>
              <td>set-up {index + 1}</td>
              <td>{outcome.label}</td>
              <td>{outcome.detail}</td>
            </tr>
          ))}
          {result.outcomes.map((outcome, index) => (
            <tr key={`checkout-${index}`}>
              <td>checkout {index + 1}</td>
              <td>{outcome.label}</td>
              <td>{outcome.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** Creates a cart and sets it to one unit of the scarce product. Resolves to the cart's identifier. */
async function prepareCart(customer: CustomerId): Promise<string> {
  const cart = await createCart(customer);
  await setCartLineQuantity(customer, cart.id, SCARCE_PRODUCT, 1);
  return cart.id;
}

/** The count typed into the form, kept within the range the race tool supports. */
function clampCheckouts(input: string): number {
  const value = Math.trunc(Number(input));
  if (!Number.isFinite(value)) return DEFAULT_CHECKOUTS;
  return Math.min(MAX_CHECKOUTS, Math.max(MIN_CHECKOUTS, value));
}
