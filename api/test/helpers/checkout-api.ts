import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { createCart, setLine } from './cart-api.js';
import type { Order } from './api-types.js';

/** Thin wrappers over the checkout and order endpoints. Each returns the raw response so tests can assert on it. */

/**
 * The one place tests check a cart out. Every checkout in the suite goes through
 * here, so a change to the checkout request (for example a required header) is
 * made once. Each call sends a fresh idempotency key unless the test passes one.
 * A payment token is sent in the body only when the test passes one, so the default request has no body.
 */
export function checkOut(
  app: Express,
  customerId: string,
  cartId: string,
  idempotencyKey: string = randomUUID(),
  paymentToken?: string,
) {
  const attempt = request(app)
    .post(`/api/carts/${cartId}/checkout`)
    .set('X-Customer-Id', customerId)
    .set('Idempotency-Key', idempotencyKey);
  return paymentToken === undefined ? attempt : attempt.send({ paymentToken });
}

export function viewOrder(app: Express, customerId: string, orderId: string) {
  return request(app).get(`/api/orders/${orderId}`).set('X-Customer-Id', customerId);
}

export function listMyOrders(app: Express, customerId: string) {
  return request(app).get('/api/orders').set('X-Customer-Id', customerId);
}

/**
 * Places an order the way a customer does: creates a cart, sets each line, and
 * checks the cart out. Returns the order, and throws unless the checkout placed it.
 */
export async function placeOrder(
  app: Express,
  customerId: string,
  lines: ReadonlyArray<readonly [productId: string, quantity: number]>,
): Promise<Order> {
  const cartId = await createCart(app, customerId);
  for (const [productId, quantity] of lines) {
    const edit = await setLine(app, customerId, cartId, productId, quantity);
    if (edit.status !== 200) {
      throw new Error(`setting ${productId} to ${quantity} returned ${edit.status}: ${JSON.stringify(edit.body)}`);
    }
  }
  const response = await checkOut(app, customerId, cartId);
  if (response.status !== 201) {
    throw new Error(`checkout of cart ${cartId} returned ${response.status}: ${JSON.stringify(response.body)}`);
  }
  return response.body as Order;
}
