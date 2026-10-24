import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { ChargeOutcome, PaymentGateway } from '../../src/modules/payments/payment-gateway.js';
import { createCart, setLine, viewCart } from '../helpers/cart-api.js';
import { checkOut, listMyOrders } from '../helpers/checkout-api.js';
import { useTestDatabase } from '../helpers/test-database.js';
import type { Cart, Problem, ProductListing } from '../helpers/api-types.js';

/** Current stock of every product, keyed by product id, read through the public product listing. */
async function productStock(app: Express): Promise<Record<string, number>> {
  const { products } = (await request(app).get('/api/products')).body as ProductListing;
  return Object.fromEntries(products.map((product) => [product.id, product.stock]));
}

/** Fails its first charge with a plain error, as a provider outage would, and approves every charge after that. */
class FirstChargeFails implements PaymentGateway {
  private charges = 0;

  charge(): Promise<ChargeOutcome> {
    this.charges += 1;
    return this.charges === 1
      ? Promise.reject(new Error('payment provider unreachable'))
      : Promise.resolve('approved');
  }
}

describe('error responses', () => {
  const database = useTestDatabase();

  it('answers a request the contract rejects with 400 Problem Details and a stable code', async () => {
    const response = await request(database.app).get('/api/products?colour=red');
    const body = response.body as Problem;

    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(body).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      errors: [{ path: '/query/colour' }],
    });
    expect(body.type).toMatch(/^https:\/\//);
    expect(body.title).not.toBe('');
    expect(body.detail).not.toBe('');
    expect(body.requestId).toBe(response.headers['x-request-id']);
  });

  it('answers an unknown route under the API base path with 404 Problem Details', async () => {
    const response = await request(database.app).get('/api/no-such-resource');
    const body = response.body as Problem;

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(body).toMatchObject({ status: 404, code: 'ROUTE_NOT_FOUND' });
    expect(body.requestId).toBe(response.headers['x-request-id']);
  });

  it('answers a known path with an undocumented method with 405 Problem Details and an Allow header', async () => {
    const response = await request(database.app).delete('/api/products');
    const body = response.body as Problem;

    expect(response.status).toBe(405);
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(response.headers.allow).toBe('GET');
    expect(body).toMatchObject({ status: 405, code: 'METHOD_NOT_ALLOWED' });
    expect(body.requestId).toBe(response.headers['x-request-id']);
  });

  it('answers a body above the parser limit with 413 Problem Details', async () => {
    const oversized = JSON.stringify({ padding: 'x'.repeat(200_000) });
    const response = await request(database.app)
      .post('/api/carts')
      .set('X-Customer-Id', 'alice')
      .set('Content-Type', 'application/json')
      .send(oversized);
    const body = response.body as Problem;

    expect(response.status).toBe(413);
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(body).toMatchObject({ status: 413, code: 'PAYLOAD_TOO_LARGE' });
    expect(body.requestId).toBe(response.headers['x-request-id']);
  });

  it('answers a body of a media type the operation does not accept with 415 Problem Details', async () => {
    const cartId = await createCart(database.app, 'alice');
    const response = await request(database.app)
      .post(`/api/carts/${cartId}/checkout`)
      .set('X-Customer-Id', 'alice')
      .set('Idempotency-Key', randomUUID())
      .set('Content-Type', 'text/plain')
      .send('tok_ok');
    const body = response.body as Problem;

    expect(response.status).toBe(415);
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(body).toMatchObject({ status: 415, code: 'UNSUPPORTED_MEDIA_TYPE' });
    expect(body.requestId).toBe(response.headers['x-request-id']);
  });

  it('answers a body that is not JSON with 400 MALFORMED_JSON before any business logic', async () => {
    const response = await request(database.app)
      .post('/api/products')
      .set('Content-Type', 'application/json')
      .send('{"name": ');
    const body = response.body as Problem;

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ status: 400, code: 'MALFORMED_JSON' });
  });

  it('answers a path outside the API with 404 Problem Details rather than an HTML page', async () => {
    const response = await request(database.app).get('/no-such-page');
    const body = response.body as Problem;

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(body).toMatchObject({ status: 404, code: 'ROUTE_NOT_FOUND' });
  });
});

describe('a checkout that fails inside the service', () => {
  const database = useTestDatabase({ payments: new FirstChargeFails() });

  it('answers 500 INTERNAL_ERROR with nothing placed, and places the order when retried with the same key', async () => {
    const cartId = await createCart(database.app, 'alice');
    await setLine(database.app, 'alice', cartId, 'limited-hoodie', 2);
    const stockBefore = await productStock(database.app);
    const key = randomUUID();

    const failed = await checkOut(database.app, 'alice', cartId, key);
    const body = failed.body as Problem;

    expect(failed.status).toBe(500);
    expect(failed.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(body).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
    expect(body.requestId).toBe(failed.headers['x-request-id']);
    expect(await productStock(database.app)).toEqual(stockBefore);
    expect((await viewCart(database.app, 'alice', cartId)).body as Cart).toMatchObject({ status: 'open' });
    expect((await listMyOrders(database.app, 'alice')).body).toEqual({ orders: [] });

    const retried = await checkOut(database.app, 'alice', cartId, key);

    // The failed attempt took no order number, so the retry is the first order.
    expect(retried.status).toBe(201);
    expect(retried.body).toMatchObject({ orderNumber: 1 });
  });
});
