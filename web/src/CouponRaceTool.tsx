import { useState } from 'react';
import {
  type Coupon,
  checkOutCart,
  createCart,
  listMyCoupons,
  newIdempotencyKey,
  setCartLineQuantity,
} from './api/client';
import type { CustomerId } from './customer';
import { ErrorDetails } from './ErrorDetails';
import { countLabels, type Outcome, placed, refusal } from './outcomes';

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

      const carts = clampCarts(input);
      // Fresh carts, one unit of the product each. The customer's own cart is never touched.
      const prepared = await Promise.allSettled(
        Array.from({ length: carts }, () => prepareCart(customer)),
      );
      const cartIds = prepared.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
      const setup = prepared.flatMap((result) =>
        result.status === 'rejected' ? [refusal(result.reason)] : [],
      );

      // Every checkout starts in the same moment, each with its own key and the same coupon.
      // No expected total is sent, so the race is decided by the coupon alone.
      const settled = await Promise.allSettled(
        cartIds.map((cartId) =>
          checkOutCart(customer, cartId, newIdempotencyKey(), 'tok_ok', undefined, coupon.code),
        ),
      );
      const outcomes = settled.map((result) =>
        result.status === 'fulfilled' ? placed(result.value) : refusal(result.reason),
      );

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
  const counts = countLabels([
    ...result.setup.map((outcome) => ({ ...outcome, label: `set-up: ${outcome.label}` })),
    ...result.outcomes,
  ]);
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

/** Creates a cart holding one unit of the race product. Resolves to the cart's identifier. */
async function prepareCart(customer: CustomerId): Promise<string> {
  const cart = await createCart(customer);
  await setCartLineQuantity(customer, cart.id, RACE_PRODUCT, 1);
  return cart.id;
}

/** The count typed into the form, kept within the range the race supports. */
function clampCarts(input: string): number {
  const value = Math.trunc(Number(input));
  if (!Number.isFinite(value)) return DEFAULT_CARTS;
  return Math.min(MAX_CARTS, Math.max(MIN_CARTS, value));
}
