import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { useTestDatabase } from '../helpers/test-database.js';
import type { Problem } from '../helpers/api-types.js';

const SOME_CART = '6f1c2a0e-0b8e-4c53-9a4e-2a8f1d7c9e10';

describe('customer identity on cart operations', () => {
  const database = useTestDatabase();

  it.each([
    ['create a cart', () => request(database.app).post('/api/carts')],
    ['view a cart', () => request(database.app).get(`/api/carts/${SOME_CART}`)],
    [
      'set a line quantity',
      () =>
        request(database.app)
          .put(`/api/carts/${SOME_CART}/lines/ceramic-mug`)
          .send({ quantity: 1 }),
    ],
    ['remove a line', () => request(database.app).delete(`/api/carts/${SOME_CART}/lines/ceramic-mug`)],
  ])('answers a request to %s without the customer header with 400 CUSTOMER_ID_REQUIRED', async (_label, send) => {
    const response = await send();
    const body = response.body as Problem;

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ status: 400, code: 'CUSTOMER_ID_REQUIRED' });
    expect(body.requestId).toBe(response.headers['x-request-id']);
  });

  it('treats a blank customer header as missing', async () => {
    const response = await request(database.app).post('/api/carts').set('X-Customer-Id', '   ');

    expect(response.status).toBe(400);
    expect(response.body as Problem).toMatchObject({ code: 'CUSTOMER_ID_REQUIRED' });
  });

  it.each([
    ['contains spaces', 'has spaces'],
    ['contains a slash', 'bad/identifier'],
    ['exceeds 128 characters', 'a'.repeat(129)],
  ])('rejects a customer identifier that %s with 400 VALIDATION_FAILED', async (_label, value) => {
    const response = await request(database.app).post('/api/carts').set('X-Customer-Id', value);

    expect(response.status).toBe(400);
    expect(response.body as Problem).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
  });
});
