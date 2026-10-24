import { useCallback, useState } from 'react';
import { CartPanel } from './CartPanel';
import { CustomerSwitcher } from './CustomerSwitcher';
import { type CustomerId, loadCustomer, saveCustomer } from './customer';
import { ProductSection } from './ProductSection';
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

function CustomerWorkspace({ customer }: { customer: CustomerId }) {
  const cart = useCart(customer);

  return (
    <>
      <ProductSection cart={cart} />
      <CartPanel cart={cart} />
    </>
  );
}
