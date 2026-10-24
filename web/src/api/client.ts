import type { components } from './schema.gen';

/** Types come from the OpenAPI document, so a contract change breaks this build. */
export type Product = components['schemas']['Product'];
export type ProductList = components['schemas']['ProductList'];
export type Problem = components['schemas']['Problem'];
export type Cart = components['schemas']['Cart'];
export type CartLine = components['schemas']['CartLine'];

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
