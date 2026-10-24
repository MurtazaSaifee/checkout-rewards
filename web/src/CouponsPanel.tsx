import { useEffect, useState } from 'react';
import { type Coupon, listMyCoupons } from './api/client';
import type { CustomerId } from './customer';
import { ErrorDetails } from './ErrorDetails';

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; coupons: Coupon[] }
  | { kind: 'failed'; error: unknown };

export interface CouponsPanelProps {
  customer: CustomerId;
  /** Changes when an order is placed or a coupon is issued, so the list is read again. */
  version: number;
}

export function CouponsPanel({ customer, version }: CouponsPanelProps) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    listMyCoupons(customer, controller.signal).then(
      (list) => {
        setLoad({ kind: 'ready', coupons: list.coupons });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setLoad({ kind: 'failed', error });
      },
    );
    return () => {
      controller.abort();
    };
  }, [customer, version, attempt]);

  return (
    <section aria-labelledby="coupons-heading">
      <header>
        <h2 id="coupons-heading">My coupons</h2>
        <button
          type="button"
          onClick={() => {
            setLoad({ kind: 'loading' });
            setAttempt((count) => count + 1);
          }}
        >
          Refresh coupons
        </button>
      </header>

      {load.kind === 'loading' ? <p>Loading coupons…</p> : null}
      {load.kind === 'failed' ? <ErrorDetails error={load.error} /> : null}
      {load.kind === 'ready' && load.coupons.length === 0 ? (
        <p>This customer has no coupons yet. One is issued for every nth order, once an administrator generates it.</p>
      ) : null}
      {load.kind === 'ready' && load.coupons.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th scope="col">Milestone</th>
              <th scope="col">Code</th>
              <th scope="col">Percent off</th>
              <th scope="col">Redeemed</th>
            </tr>
          </thead>
          <tbody>
            {load.coupons.map((coupon) => (
              <tr key={coupon.code}>
                <td>{coupon.milestone}</td>
                <td>
                  <code>{coupon.code}</code>
                </td>
                <td>{coupon.percentOff}%</td>
                <td>{coupon.redeemed ? 'yes' : 'no'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
