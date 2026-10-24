import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';

/** Thin wrappers over the checkout and order endpoints. Each returns the raw response so tests can assert on it. */

/**
 * Checks out a cart. Each call sends a fresh idempotency key unless the test passes one.
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
