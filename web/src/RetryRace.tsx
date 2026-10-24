import { useState } from 'react';
import { checkOutCart, createCart, listProducts, newIdempotencyKey, type Order, setCartLineQuantity } from './api/client';
import type { CustomerId } from './customer';
import { ErrorDetails } from './ErrorDetails';
import { countLabels, type Outcome, placed, refusal } from './outcomes';

/** The number of retries sent at once: the race is always ten. */
const RETRIES = 10;
/** A product with plenty of stock, so the stock change shows one unit taken rather than a sell-out. */
const RETRY_PRODUCT = 'notebook-set';

interface RetryResult {
  key: string;
  outcomes: Outcome[];
  /** Distinct orders among the successful responses. One is the expected answer. */
  distinctOrders: number;
  /** True when all ten responses succeeded and carried the same body. */
  identical: boolean;
  stockBefore: number | undefined;
  stockAfter: number | undefined;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; result: RetryResult }
  | { kind: 'failed'; error: unknown };

/**
 * Retries one checkout ten times at the same moment, with one idempotency key. The
 * server should place one order, take the stock once, and answer every retry alike.
 */
export function RetryRace({ customer, onFinished }: { customer: CustomerId; onFinished: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  async function race(): Promise<void> {
    setPhase({ kind: 'running' });
    try {
      // A fresh cart, so the customer's own cart is never touched.
      const cart = await createCart(customer);
      await setCartLineQuantity(customer, cart.id, RETRY_PRODUCT, 1);
      const stockBefore = await stockOf();

      const key = newIdempotencyKey();
      const settled = await Promise.allSettled(
        Array.from({ length: RETRIES }, () => checkOutCart(customer, cart.id, key, { paymentToken: 'tok_ok' })),
      );
      const stockAfter = await stockOf();

      const orders = settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
      setPhase({
        kind: 'done',
        result: {
          key,
          outcomes: settled.map((result) =>
            result.status === 'fulfilled' ? placed(result.value) : refusal(result.reason),
          ),
          distinctOrders: new Set(orders.map((order) => order.id)).size,
          identical: orders.length === RETRIES && new Set(orders.map(serialise)).size === 1,
          stockBefore,
          stockAfter,
        },
      });
    } catch (error: unknown) {
      setPhase({ kind: 'failed', error });
    }
    onFinished();
  }

  return (
    <section aria-labelledby="retry-race-heading">
      <h2 id="retry-race-heading">Race: ten retries with one key</h2>
      <p>
        Creates a fresh cart with one <code>{RETRY_PRODUCT}</code>, then sends {RETRIES} checkouts at the
        same moment, all with one <code>Idempotency-Key</code>. One order should be placed, the stock taken
        once, and every response should be the same.
      </p>
      <button type="button" disabled={phase.kind === 'running'} onClick={() => void race()}>
        {phase.kind === 'running' ? 'Retrying…' : `Retry ${RETRIES} times`}
      </button>

      {phase.kind === 'done' ? <RetrySummary result={phase.result} /> : null}
      {phase.kind === 'failed' ? <ErrorDetails error={phase.error} /> : null}
    </section>
  );
}

function RetrySummary({ result }: { result: RetryResult }) {
  const placedCount = result.outcomes.filter((outcome) => outcome.placed).length;

  return (
    <>
      <p>
        Key <code>{result.key}</code>. {RETRIES} retries returned <strong>{placedCount} placed</strong> and{' '}
        {RETRIES - placedCount} refused. Distinct orders: <strong>{result.distinctOrders}</strong>. All responses
        identical: <strong>{result.identical ? 'yes' : 'no'}</strong>. Stock of <code>{RETRY_PRODUCT}</code>:{' '}
        {result.stockBefore ?? 'unknown'} before, {result.stockAfter ?? 'unknown'} after.
      </p>
      <table>
        <thead>
          <tr>
            <th scope="col">Outcome</th>
            <th scope="col">Count</th>
          </tr>
        </thead>
        <tbody>
          {countLabels(result.outcomes).map(([label, count]) => (
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
            <th scope="col">Retry</th>
            <th scope="col">Outcome</th>
            <th scope="col">Detail</th>
          </tr>
        </thead>
        <tbody>
          {result.outcomes.map((outcome, index) => (
            <tr key={`retry-${index}`}>
              <td>retry {index + 1}</td>
              <td>{outcome.label}</td>
              <td>{outcome.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** The product's stock now, or undefined if the catalogue cannot be read. */
async function stockOf(): Promise<number | undefined> {
  const { products } = await listProducts();
  return products.find((product) => product.id === RETRY_PRODUCT)?.stock;
}

/** A response as text, so two responses compare equal only when every field matches. */
function serialise(order: Order): string {
  return JSON.stringify(order);
}
