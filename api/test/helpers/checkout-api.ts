import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { createCart, setLine } from './cart-api.js';
import type { Order } from './api-types.js';

/** Thin wrappers over the checkout and order endpoints. Each returns the raw response so tests can assert on it. */

/** What a test passes to checkOut. Each option is sent only when it is given. */
export interface CheckOutOptions {
  /** Identifies this attempt. A fresh key is sent when none is given. */
  idempotencyKey?: string;
  paymentToken?: string;
  couponCode?: string;
}

/**
 * The usual way tests check a cart out, so the headers a checkout needs are set in
 * one place. A few tests post to the checkout route directly. The body carries only
 * the options the test passes, so the default request has no body.
 */
export function checkOut(app: Express, customerId: string, cartId: string, options: CheckOutOptions = {}) {
  const attempt = request(app)
    .post(`/api/carts/${cartId}/checkout`)
    .set('X-Customer-Id', customerId)
    .set('Idempotency-Key', options.idempotencyKey ?? randomUUID());
  const body = {
    ...(options.paymentToken === undefined ? {} : { paymentToken: options.paymentToken }),
    ...(options.couponCode === undefined ? {} : { couponCode: options.couponCode }),
  };
  return Object.keys(body).length === 0 ? attempt : attempt.send(body);
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
