import request from 'supertest';
import type { Express } from 'express';

/** Thin wrappers over the checkout and order endpoints. Each returns the raw response so tests can assert on it. */

export function checkOut(app: Express, customerId: string, cartId: string) {
  return request(app).post(`/api/carts/${cartId}/checkout`).set('X-Customer-Id', customerId);
}

export function viewOrder(app: Express, customerId: string, orderId: string) {
  return request(app).get(`/api/orders/${orderId}`).set('X-Customer-Id', customerId);
}

export function listMyOrders(app: Express, customerId: string) {
  return request(app).get('/api/orders').set('X-Customer-Id', customerId);
}
