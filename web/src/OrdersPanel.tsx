import { useEffect, useState } from 'react';
import { listOrders, type Order } from './api/client';
import type { CustomerId } from './customer';
import { ErrorDetails } from './ErrorDetails';
import { formatCents } from './money';

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; orders: Order[] }
  | { kind: 'failed'; error: unknown };

export interface OrdersPanelProps {
  customer: CustomerId;
  /** Changes whenever an order is placed, so the list is read again. */
  version: number;
  selectedOrderId: string | undefined;
  onSelect: (orderId: string) => void;
}

export function OrdersPanel({ customer, version, selectedOrderId, onSelect }: OrdersPanelProps) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    listOrders(customer, controller.signal).then(
      (list) => {
        setLoad({ kind: 'ready', orders: list.orders });
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
    <section aria-labelledby="orders-heading">
      <header>
        <h2 id="orders-heading">My orders</h2>
        <button
          type="button"
          onClick={() => {
            setLoad({ kind: 'loading' });
            setAttempt((count) => count + 1);
          }}
        >
          Refresh orders
        </button>
      </header>

      {load.kind === 'loading' ? <p>Loading orders…</p> : null}
      {load.kind === 'failed' ? <ErrorDetails error={load.error} /> : null}
      {load.kind === 'ready' && load.orders.length === 0 ? (
        <p>This customer has no orders yet.</p>
      ) : null}
      {load.kind === 'ready' && load.orders.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th scope="col">Order</th>
              <th scope="col">Placed</th>
              <th scope="col">Lines</th>
              <th scope="col">Total</th>
              <th scope="col">View</th>
            </tr>
          </thead>
          <tbody>
            {load.orders.map((order) => (
              <tr key={order.id}>
                <td>#{order.orderNumber}</td>
                <td>{new Date(order.placedAt).toLocaleString()}</td>
                <td>{order.lines.length}</td>
                <td>{formatCents(order.totalCents)}</td>
                <td>
                  <button
                    type="button"
                    aria-pressed={order.id === selectedOrderId}
                    onClick={() => {
                      onSelect(order.id);
                    }}
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
