/**
 * The customers a tester can play. Identities are claimed through a header, so
 * these are simply the names the switcher offers.
 */
export const CUSTOMERS = ['alice', 'bob', 'carol'] as const;
export type CustomerId = (typeof CUSTOMERS)[number];

const CUSTOMER_KEY = 'checkout-rewards.customer';
const CART_KEY_PREFIX = 'checkout-rewards.cart.';

/*
 * Per-browser memory for the selected customer and the cart each customer last
 * created. Storage can be unavailable (private windows, blocked site data), so
 * every access is guarded and the app works without it, just without memory.
 */

export function loadCustomer(): CustomerId {
  const stored = readStorage(CUSTOMER_KEY);
  return CUSTOMERS.find((customer) => customer === stored) ?? CUSTOMERS[0];
}

export function saveCustomer(customer: CustomerId): void {
  writeStorage(CUSTOMER_KEY, customer);
}

export function loadCartId(customer: CustomerId): string | undefined {
  return readStorage(CART_KEY_PREFIX + customer) ?? undefined;
}

export function saveCartId(customer: CustomerId, cartId: string): void {
  writeStorage(CART_KEY_PREFIX + customer, cartId);
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not remembered for the next visit. The current session still works.
  }
}
