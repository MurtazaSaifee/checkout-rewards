import type { components } from './schema.gen';

/** Types come from the OpenAPI document, so a contract change breaks this build. */
export type Product = components['schemas']['Product'];
export type ProductList = components['schemas']['ProductList'];
export type Problem = components['schemas']['Problem'];
export type Cart = components['schemas']['Cart'];
export type CartLine = components['schemas']['CartLine'];
export type Order = components['schemas']['Order'];
export type OrderLine = components['schemas']['OrderLine'];
export type OrderList = components['schemas']['OrderList'];
/** The payment gateway's answer for one checkout: tok_ok approves, tok_decline declines. */
export type PaymentToken = NonNullable<components['schemas']['CheckoutRequest']['paymentToken']>;
export type Coupon = components['schemas']['Coupon'];
export type CouponList = components['schemas']['CouponList'];
export type GeneratedCoupon = components['schemas']['GeneratedCoupon'];
export type AdminCoupon = components['schemas']['AdminCoupon'];
export type AdminCouponList = components['schemas']['AdminCouponList'];

/** Thrown for any non-2xx answer. Keeps the full body so the UI can show it raw. */
export class ApiError extends Error {
  readonly status: number;
  readonly problem: Problem | undefined;
  readonly rawBody: string;

  constructor(status: number, rawBody: string) {
    super(`Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.rawBody = rawBody;
    this.problem = parseProblem(rawBody);
  }
}

/** Relative path: Vite proxies /api in development, nginx does so in Compose. */
const API_BASE = '/api';

export async function listProducts(signal?: AbortSignal): Promise<ProductList> {
  const response = await fetch(`${API_BASE}/products`, {
    headers: { Accept: 'application/json' },
    signal,
  });
  return readJson<ProductList>(response);
}

/** Every cart request names the calling customer. The identifier is claimed, not verified. */
function customerHeaders(customerId: string): Record<string, string> {
  return { Accept: 'application/json', 'X-Customer-Id': customerId };
}

export async function createCart(customerId: string, signal?: AbortSignal): Promise<Cart> {
  const response = await fetch(`${API_BASE}/carts`, {
    method: 'POST',
    headers: customerHeaders(customerId),
    signal,
  });
  return readJson<Cart>(response);
}

export async function getCart(customerId: string, cartId: string, signal?: AbortSignal): Promise<Cart> {
  const response = await fetch(`${API_BASE}/carts/${cartId}`, {
    headers: customerHeaders(customerId),
    signal,
  });
  return readJson<Cart>(response);
}

/** Sets the quantity, replacing any earlier one. Sent as typed, so the server's answer to bad input is shown. */
export async function setCartLineQuantity(
  customerId: string,
  cartId: string,
  productId: string,
  quantity: number,
): Promise<Cart> {
  const response = await fetch(`${API_BASE}/carts/${cartId}/lines/${productId}`, {
    method: 'PUT',
    headers: { ...customerHeaders(customerId), 'Content-Type': 'application/json' },
    body: JSON.stringify({ quantity }),
  });
  return readJson<Cart>(response);
}

export async function removeCartLine(
  customerId: string,
  cartId: string,
  productId: string,
): Promise<Cart> {
  const response = await fetch(`${API_BASE}/carts/${cartId}/lines/${productId}`, {
    method: 'DELETE',
    headers: customerHeaders(customerId),
  });
  return readJson<Cart>(response);
}

/**
 * Places the order for the cart in full, or changes nothing. The key names this attempt:
 * a retry with the same key gets the same answer back. The payment token is the gateway's
 * answer for this attempt. A refusal, including a declined payment, comes back as an ApiError.
 */
export async function checkOutCart(
  customerId: string,
  cartId: string,
  idempotencyKey: string,
  paymentToken: PaymentToken,
  signal?: AbortSignal,
): Promise<Order> {
  const response = await fetch(`${API_BASE}/carts/${cartId}/checkout`, {
    method: 'POST',
    headers: {
      ...customerHeaders(customerId),
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({ paymentToken }),
    signal,
  });
  return readJson<Order>(response);
}

/** A key for one checkout attempt. Built from random bytes, so it works outside a secure context too. */
export function newIdempotencyKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

/** The calling customer's orders, oldest first. */
export async function listOrders(customerId: string, signal?: AbortSignal): Promise<OrderList> {
  const response = await fetch(`${API_BASE}/orders`, {
    headers: customerHeaders(customerId),
    signal,
  });
  return readJson<OrderList>(response);
}

export async function getOrder(customerId: string, orderId: string, signal?: AbortSignal): Promise<Order> {
  const response = await fetch(`${API_BASE}/orders/${orderId}`, {
    headers: customerHeaders(customerId),
    signal,
  });
  return readJson<Order>(response);
}

/** The calling customer's coupons, oldest milestone first. */
export async function listMyCoupons(customerId: string, signal?: AbortSignal): Promise<CouponList> {
  const response = await fetch(`${API_BASE}/coupons`, {
    headers: customerHeaders(customerId),
    signal,
  });
  return readJson<CouponList>(response);
}

/** Every admin operation sends the admin key. The key is a placeholder, not a security control. */
function adminHeaders(adminKey: string): Record<string, string> {
  return { Accept: 'application/json', 'X-Admin-Key': adminKey };
}

/** Issues a coupon for the oldest unrewarded milestone. A refusal comes back as an ApiError. */
export async function generateCoupon(adminKey: string, signal?: AbortSignal): Promise<GeneratedCoupon> {
  const response = await fetch(`${API_BASE}/admin/coupons`, {
    method: 'POST',
    headers: adminHeaders(adminKey),
    signal,
  });
  return readJson<GeneratedCoupon>(response);
}

/** Every coupon issued, oldest milestone first, with its customer. */
export async function listAllCoupons(adminKey: string, signal?: AbortSignal): Promise<AdminCouponList> {
  const response = await fetch(`${API_BASE}/admin/coupons`, {
    headers: adminHeaders(adminKey),
    signal,
  });
  return readJson<AdminCouponList>(response);
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    throw new ApiError(response.status, text);
  }
  return JSON.parse(text) as T;
}

function parseProblem(rawBody: string): Problem | undefined {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    return isProblem(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isProblem(value: unknown): value is Problem {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof value.code === 'string' &&
    'requestId' in value &&
    typeof value.requestId === 'string'
  );
}
