import { useEffect, useState } from 'react';
import { getOrder, type Order } from './api/client';
import type { CustomerId } from './customer';
import { ErrorDetails } from './ErrorDetails';
import { formatCents } from './money';

export function OrderView({ customer, orderId }: { customer: CustomerId; orderId: string | undefined }) {
  return (
    <section aria-labelledby="order-heading">
      <h2 id="order-heading">Order</h2>
      {orderId === undefined ? (
        <p>Check out a cart, or view one of your orders, to see it here.</p>
      ) : (
        // Keyed by order, so each order is read fresh and no earlier order's lines show for it.
        <OrderDetail key={orderId} customer={customer} orderId={orderId} />
      )}
    </section>
  );
}

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; order: Order }
  | { kind: 'failed'; error: unknown };

function OrderDetail({ customer, orderId }: { customer: CustomerId; orderId: string }) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    getOrder(customer, orderId, controller.signal).then(
      (order) => {
        setLoad({ kind: 'ready', order });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setLoad({ kind: 'failed', error });
      },
    );
    return () => {
      controller.abort();
    };
  }, [customer, orderId]);

  if (load.kind === 'loading') return <p>Loading order…</p>;
  if (load.kind === 'failed') return <ErrorDetails error={load.error} />;

  const { order } = load;
  return (
    <>
      <p>
        Order <strong>#{order.orderNumber}</strong> · placed {new Date(order.placedAt).toLocaleString()} ·{' '}
        <code>{order.id}</code>
      </p>
      <table>
        <thead>
          <tr>
            <th scope="col">Product</th>
            <th scope="col">Unit price</th>
            <th scope="col">Quantity</th>
            <th scope="col">Line amount</th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((line) => (
            <tr key={line.productId}>
              <td>
                {line.name}
                <br />
                <code>{line.productId}</code>
              </td>
              <td>{formatCents(line.unitPriceCents)}</td>
              <td>{line.quantity}</td>
              <td>{formatCents(line.lineAmountCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl>
        <dt>subtotal</dt>
        <dd>{formatCents(order.subtotalCents)}</dd>
        <dt>total</dt>
        <dd>{formatCents(order.totalCents)}</dd>
      </dl>
    </>
  );
}
