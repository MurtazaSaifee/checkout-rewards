import request from 'supertest';
import type { Express } from 'express';
import type { Cart } from './api-types.js';

/** Thin wrappers over the cart endpoints. Each returns the raw response so tests can assert on it. */

export async function createCart(app: Express, customerId: string): Promise<string> {
  const response = await request(app).post('/api/carts').set('X-Customer-Id', customerId);
  return (response.body as Cart).id;
}

export function viewCart(app: Express, customerId: string, cartId: string) {
  return request(app).get(`/api/carts/${cartId}`).set('X-Customer-Id', customerId);
}

export function setLine(
  app: Express,
  customerId: string,
  cartId: string,
  productId: string,
  quantity: number,
) {
  return request(app)
    .put(`/api/carts/${cartId}/lines/${productId}`)
    .set('X-Customer-Id', customerId)
    .send({ quantity });
}

export function removeLine(app: Express, customerId: string, cartId: string, productId: string) {
  return request(app).delete(`/api/carts/${cartId}/lines/${productId}`).set('X-Customer-Id', customerId);
}
