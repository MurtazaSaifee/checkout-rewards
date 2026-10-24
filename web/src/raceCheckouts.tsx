import { checkOutCart, createCart, newIdempotencyKey, setCartLineQuantity } from './api/client';
import type { CustomerId } from './customer';
import { countLabels, type Outcome, placed, refusal } from './outcomes';

/** The carts a race fires: those that are set up, and the outcomes of those that were not. */
export interface PreparedCarts {
  cartIds: string[];
  /** Carts that could not be set up, so they never checked out. */
  setup: Outcome[];
}

/** The range a race's count input is kept within, and the value used when the input is not a number. */
export interface CountRange {
  min: number;
  max: number;
  fallback: number;
}

/** The count typed into a race form, kept within its range. */
export function clampCount(input: string, { min, max, fallback }: CountRange): number {
  const value = Math.trunc(Number(input));
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/**
 * Creates `count` fresh carts, each holding one unit of the product, so the customer's own
 * cart is never touched. A cart that cannot be set up is reported as a setup outcome.
 */
export async function prepareCarts(customer: CustomerId, productId: string, count: number): Promise<PreparedCarts> {
  const prepared = await Promise.allSettled(
    Array.from({ length: count }, () => prepareCart(customer, productId)),
  );
  return {
    cartIds: prepared.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
    setup: prepared.flatMap((result) => (result.status === 'rejected' ? [refusal(result.reason)] : [])),
  };
}

async function prepareCart(customer: CustomerId, productId: string): Promise<string> {
  const cart = await createCart(customer);
  await setCartLineQuantity(customer, cart.id, productId, 1);
  return cart.id;
}

/**
 * Starts one checkout per cart at the same moment, so the server receives them together.
 * Each is a separate attempt with its own key, and each pays with the approving test token.
 * A coupon, when given, is redeemed by each checkout. Resolves to one outcome per cart, in
 * the order the carts were given.
 */
export async function fireCheckouts(
  customer: CustomerId,
  cartIds: readonly string[],
  couponCode?: string,
): Promise<Outcome[]> {
  const settled = await Promise.allSettled(
    cartIds.map((cartId) =>
      checkOutCart(customer, cartId, newIdempotencyKey(), { paymentToken: 'tok_ok', couponCode }),
    ),
  );
  return settled.map((result) => (result.status === 'fulfilled' ? placed(result.value) : refusal(result.reason)));
}

/** The outcome counts and the stage-by-stage table that every race shows. */
export function RaceTables({ setup, outcomes }: { setup: readonly Outcome[]; outcomes: readonly Outcome[] }) {
  const counts = countLabels([
    ...setup.map((outcome) => ({ ...outcome, label: `set-up: ${outcome.label}` })),
    ...outcomes,
  ]);

  return (
    <>
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
          {setup.map((outcome, index) => (
            <tr key={`set-up-${index}`}>
              <td>set-up {index + 1}</td>
              <td>{outcome.label}</td>
              <td>{outcome.detail}</td>
            </tr>
          ))}
          {outcomes.map((outcome, index) => (
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
