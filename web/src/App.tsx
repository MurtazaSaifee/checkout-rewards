import { useCallback, useState } from 'react';
import type { Order } from './api/client';
import { AdminPanel } from './AdminPanel';
import { CartPanel } from './CartPanel';
import { CouponRaceTool } from './CouponRaceTool';
import { CouponsPanel } from './CouponsPanel';
import { CustomerSwitcher } from './CustomerSwitcher';
import { type CustomerId, loadCustomer, saveCustomer } from './customer';
import { OrdersPanel } from './OrdersPanel';
import { OrderView } from './OrderView';
import { ProductSection } from './ProductSection';
import { RaceTool } from './RaceTool';
import { RetryRace } from './RetryRace';
import { useCart } from './useCart';

export function App() {
  const [customer, setCustomer] = useState<CustomerId>(loadCustomer);
  // Shared with the administrator's panel: issuing a coupon refreshes every customer's coupon list.
  const [couponsVersion, setCouponsVersion] = useState(0);

  const switchCustomer = useCallback((next: CustomerId) => {
    saveCustomer(next);
    setCustomer(next);
  }, []);

  const couponIssued = useCallback(() => {
    setCouponsVersion((version) => version + 1);
  }, []);

  return (
    <main>
      <header>
        <h1>Checkout and Rewards</h1>
        <CustomerSwitcher value={customer} onChange={switchCustomer} />
      </header>

      {/* Keyed by customer, so one customer's cart state never shows for another. */}
      <CustomerWorkspace key={customer} customer={customer} couponsVersion={couponsVersion} />

      <AdminPanel onIssued={couponIssued} />
    </main>
  );
}

/**
 * Everything a customer sees and does. It is keyed by customer, so the selected
 * order and the refresh counters all start afresh when the customer changes.
 */
function CustomerWorkspace({ customer, couponsVersion }: { customer: CustomerId; couponsVersion: number }) {
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
      {/* A coupon issue and a placed order both change the list, so either one reads it again. */}
      <CouponsPanel customer={customer} version={couponsVersion + ordersVersion} />
      <RaceTool customer={customer} onFinished={refreshAfterOrders} />
      <RetryRace customer={customer} onFinished={refreshAfterOrders} />
      <CouponRaceTool customer={customer} onFinished={refreshAfterOrders} />
    </>
  );
}
