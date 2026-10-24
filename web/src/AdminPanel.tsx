import { useState } from 'react';
import {
  type AdminCoupon,
  type AdminOrder,
  type GeneratedCoupon,
  generateCoupon,
  getReport,
  listAllCoupons,
  listAllOrders,
  type Report,
} from './api/client';
import { ErrorDetails } from './ErrorDetails';
import { formatCents } from './money';

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

/** A read the administrator asks for: not asked yet, in flight, answered, or refused. */
type Loaded<T> =
  | { kind: 'hidden' }
  | { kind: 'loading' }
  | { kind: 'ready'; value: T }
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
  const [report, setReport] = useState<Loaded<Report>>({ kind: 'hidden' });
  const [orders, setOrders] = useState<Loaded<AdminOrder[]>>({ kind: 'hidden' });
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

  function loadReport(): void {
    setReport({ kind: 'loading' });
    getReport(adminKey).then(
      (value) => {
        setReport({ kind: 'ready', value });
      },
      (error: unknown) => {
        setReport({ kind: 'failed', error });
      },
    );
  }

  function loadOrders(): void {
    setOrders({ kind: 'loading' });
    listAllOrders(adminKey).then(
      (list) => {
        setOrders({ kind: 'ready', value: list.orders });
      },
      (error: unknown) => {
        setOrders({ kind: 'failed', error });
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
        // Keep open lists current, so the new coupon appears without a second click.
        if (all.kind !== 'hidden') loadAll();
        // Issuing a coupon changes the report's coupon counts and unrewarded milestones.
        if (report.kind !== 'hidden') loadReport();
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

      <h3>Report</h3>
      <p>
        Calculated from every placed order and every coupon when it is loaded, so it reflects the store at
        that moment.
      </p>
      <button
        type="button"
        onClick={() => {
          loadReport();
        }}
      >
        {report.kind === 'hidden' ? 'Load report' : 'Refresh report'}
      </button>

      {report.kind === 'loading' ? <p>Loading report…</p> : null}
      {report.kind === 'failed' ? <ErrorDetails error={report.error} /> : null}
      {report.kind === 'ready' ? <ReportSummary report={report.value} /> : null}

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

      <h3>All orders</h3>
      <button
        type="button"
        onClick={() => {
          loadOrders();
        }}
      >
        {orders.kind === 'hidden' ? 'Load all orders' : 'Refresh all orders'}
      </button>

      {orders.kind === 'loading' ? <p>Loading orders…</p> : null}
      {orders.kind === 'failed' ? <ErrorDetails error={orders.error} /> : null}
      {orders.kind === 'ready' && orders.value.length === 0 ? <p>No order has been placed yet.</p> : null}
      {orders.kind === 'ready' && orders.value.length > 0 ? <OrdersTable orders={orders.value} /> : null}
    </section>
  );
}

/** The report's figures, then the units sold of each product. Money is shown from integer cents. */
function ReportSummary({ report }: { report: Report }) {
  return (
    <>
      <dl>
        <dt>Orders placed</dt>
        <dd>{report.orderCount}</dd>
        <dt>Gross revenue</dt>
        <dd>{formatCents(report.grossRevenueCents)}</dd>
        <dt>Discounts</dt>
        <dd>{formatCents(report.discountCents)}</dd>
        <dt>Net revenue</dt>
        <dd>{formatCents(report.netRevenueCents)}</dd>
        <dt>Coupons generated</dt>
        <dd>{report.couponsGenerated}</dd>
        <dt>Coupons redeemed</dt>
        <dd>{report.couponsRedeemed}</dd>
        <dt>Coupons available</dt>
        <dd>{report.couponsAvailable}</dd>
        <dt>Unrewarded milestones</dt>
        <dd>{report.unrewardedMilestones}</dd>
      </dl>

      <h4>Units sold</h4>
      {report.unitsSold.length === 0 ? (
        <p>No units have been sold yet.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col">Units</th>
            </tr>
          </thead>
          <tbody>
            {report.unitsSold.map((units) => (
              <tr key={units.productId}>
                <td>
                  {units.name} <code>{units.productId}</code>
                </td>
                <td className="numeric">{units.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/** Every order with its customer, lines and totals. Each figure is the snapshot taken at checkout. */
function OrdersTable({ orders }: { orders: AdminOrder[] }) {
  return (
    <div className="table-scroll">
      <table className="admin-table">
        <thead>
          <tr>
            <th scope="col">Order</th>
            <th scope="col">Placed</th>
            <th scope="col">Customer</th>
            <th scope="col">Lines</th>
            <th scope="col">Subtotal</th>
            <th scope="col">Discount</th>
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id}>
              <td>#{order.orderNumber}</td>
              <td>{new Date(order.placedAt).toLocaleString()}</td>
              <td>{order.customerId}</td>
              <td>
                {order.lines.map((line) => (
                  <div key={line.productId}>
                    {line.quantity} × {line.name}
                  </div>
                ))}
              </td>
              <td className="numeric">{formatCents(order.subtotalCents)}</td>
              <td className="numeric">
                {formatCents(order.discountCents)}
                {order.couponCode !== null ? (
                  <div>
                    <code>{order.couponCode}</code>
                  </div>
                ) : null}
              </td>
              <td className="numeric">{formatCents(order.totalCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
