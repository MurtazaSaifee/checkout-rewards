import { useCallback, useState } from 'react';
import type { Order } from './api/client';
import { CartPanel } from './CartPanel';
import { CustomerSwitcher } from './CustomerSwitcher';
import { type CustomerId, loadCustomer, saveCustomer } from './customer';
import { OrdersPanel } from './OrdersPanel';
import { OrderView } from './OrderView';
import { ProductSection } from './ProductSection';
import { RaceTool } from './RaceTool';
import { useCart } from './useCart';

export function App() {
  const [customer, setCustomer] = useState<CustomerId>(loadCustomer);

  const switchCustomer = useCallback((next: CustomerId) => {
    saveCustomer(next);
    setCustomer(next);
  }, []);

  return (
    <main>
      <header>
        <h1>Checkout and Rewards</h1>
        <CustomerSwitcher value={customer} onChange={switchCustomer} />
      </header>

      {/* Keyed by customer, so one customer's cart state never shows for another. */}
      <CustomerWorkspace key={customer} customer={customer} />
    </main>
  );
}

/**
 * Everything a customer sees and does. It is keyed by customer, so the selected
 * order and the refresh counters all start afresh when the customer changes.
 */
function CustomerWorkspace({ customer }: { customer: CustomerId }) {
  const [selectedOrderId, setSelectedOrderId] = useState<string | undefined>(undefined);
  const [ordersVersion, setOrdersVersion] = useState(0);
  const [stockVersion, setStockVersion] = useState(0);

  // A placed order changes what the orders list shows and how much stock is left.
  const refreshAfterOrders = useCallback(() => {
    setOrdersVersion((version) => version + 1);
    setStockVersion((version) => version + 1);
  }, []);

  const onOrderPlaced = useCallback(
    (order: Order) => {
      setSelectedOrderId(order.id);
      refreshAfterOrders();
    },
    [refreshAfterOrders],
  );

  const cart = useCart(customer, { onOrderPlaced });

  return (
    <>
      <ProductSection cart={cart} stockVersion={stockVersion} />
      <CartPanel cart={cart} />
      <OrdersPanel
        customer={customer}
        version={ordersVersion}
        selectedOrderId={selectedOrderId}
        onSelect={setSelectedOrderId}
      />
      <OrderView customer={customer} orderId={selectedOrderId} />
      <RaceTool customer={customer} onFinished={refreshAfterOrders} />
    </>
  );
}
