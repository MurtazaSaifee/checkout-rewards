import { useState } from 'react';
import { type AdminCoupon, type GeneratedCoupon, generateCoupon, listAllCoupons } from './api/client';
import { ErrorDetails } from './ErrorDetails';

/** What the last generate call answered: a coupon, or the refusal exactly as the server sent it. */
type Outcome =
  | { kind: 'none' }
  | { kind: 'issued'; result: GeneratedCoupon }
  | { kind: 'refused'; error: unknown };

type AllCoupons =
  | { kind: 'hidden' }
  | { kind: 'loading' }
  | { kind: 'ready'; coupons: AdminCoupon[] }
  | { kind: 'failed'; error: unknown };

/**
 * The administrator's view. The admin key is typed here and kept only in this
 * component's memory: it is a placeholder, sent with each admin request, and
 * never stored in the browser. onIssued runs after a coupon is issued, so the
 * customer's coupons are read again.
 */
export function AdminPanel({ onIssued }: { onIssued: () => void }) {
  const [adminKey, setAdminKey] = useState('');
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'none' });
  const [all, setAll] = useState<AllCoupons>({ kind: 'hidden' });
  const [generating, setGenerating] = useState(false);

  function loadAll(): void {
    setAll({ kind: 'loading' });
    listAllCoupons(adminKey).then(
      (list) => {
        setAll({ kind: 'ready', coupons: list.coupons });
      },
      (error: unknown) => {
        setAll({ kind: 'failed', error });
      },
    );
  }

  function generate(): void {
    setGenerating(true);
    generateCoupon(adminKey).then(
      (result) => {
        setOutcome({ kind: 'issued', result });
        setGenerating(false);
        onIssued();
        // Keep an open list current, so the new coupon appears without a second click.
        if (all.kind !== 'hidden') loadAll();
      },
      (error: unknown) => {
        setOutcome({ kind: 'refused', error });
        setGenerating(false);
      },
    );
  }

  return (
    <section aria-labelledby="admin-heading">
      <h2 id="admin-heading">Administration</h2>

      <form
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <label>
          Admin key{' '}
          <input
            type="password"
            autoComplete="off"
            value={adminKey}
            placeholder="the development key from the README"
            onChange={(event) => {
              setAdminKey(event.target.value);
            }}
          />
        </label>
      </form>

      <h3>Generate a coupon</h3>
      <p>
        Issues one coupon for the oldest milestone that has none yet, to the customer who placed that
        milestone&apos;s order.
      </p>
      <button
        type="button"
        disabled={generating}
        onClick={() => {
          generate();
        }}
      >
        {generating ? 'Generating…' : 'Generate coupon'}
      </button>

      {outcome.kind === 'issued' ? (
        <p role="status">
          Issued <code>{outcome.result.coupon.code}</code> for milestone {outcome.result.coupon.milestone},{' '}
          {outcome.result.coupon.percentOff}% off, to customer <strong>{outcome.result.customerId}</strong>.{' '}
          Reached milestones still without a coupon: {outcome.result.unrewardedMilestonesRemaining}.
        </p>
      ) : null}
      {outcome.kind === 'refused' ? <ErrorDetails error={outcome.error} /> : null}

      <h3>All coupons</h3>
      <button
        type="button"
        onClick={() => {
          loadAll();
        }}
      >
        {all.kind === 'hidden' ? 'Load all coupons' : 'Refresh all coupons'}
      </button>

      {all.kind === 'loading' ? <p>Loading coupons…</p> : null}
      {all.kind === 'failed' ? <ErrorDetails error={all.error} /> : null}
      {all.kind === 'ready' && all.coupons.length === 0 ? <p>No coupon has been issued yet.</p> : null}
      {all.kind === 'ready' && all.coupons.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th scope="col">Milestone</th>
              <th scope="col">Code</th>
              <th scope="col">Percent off</th>
              <th scope="col">Customer</th>
              <th scope="col">Issued</th>
              <th scope="col">Redeemed by order</th>
            </tr>
          </thead>
          <tbody>
            {all.coupons.map((coupon) => (
              <tr key={coupon.code}>
                <td>{coupon.milestone}</td>
                <td>
                  <code>{coupon.code}</code>
                </td>
                <td>{coupon.percentOff}%</td>
                <td>{coupon.customerId}</td>
                <td>{new Date(coupon.issuedAt).toLocaleString()}</td>
                <td>{coupon.redeemedByOrderId ?? 'not redeemed'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
