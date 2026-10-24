import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { useTestDatabase } from '../helpers/test-database.js';
import type { Cart, Problem } from '../helpers/api-types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('POST /api/carts', () => {
  const database = useTestDatabase();

  it('creates an empty open cart', async () => {
    const response = await request(database.app)
      .post('/api/carts')
      .set('X-Customer-Id', 'alice');
    const cart = response.body as Cart;

    expect(response.status).toBe(201);
    expect(cart).toEqual({
      id: expect.stringMatching(UUID),
      status: 'open',
      lines: [],
      lineCount: 0,
      subtotalCents: 0,
    });
  });

  it('creates another empty cart when a creation is retried, so a retry does no harm', async () => {
    const first = await request(database.app).post('/api/carts').set('X-Customer-Id', 'alice');
    const second = await request(database.app).post('/api/carts').set('X-Customer-Id', 'alice');

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect((second.body as Cart).id).not.toBe((first.body as Cart).id);
    expect((second.body as Cart).lines).toEqual([]);
  });
});

describe('GET /api/carts/{cartId}', () => {
  const database = useTestDatabase();

  async function createCartFor(customerId: string): Promise<string> {
    const response = await request(database.app).post('/api/carts').set('X-Customer-Id', customerId);
    return (response.body as Cart).id;
  }

  it("shows a customer's own cart", async () => {
    const cartId = await createCartFor('alice');

    const response = await request(database.app)
      .get(`/api/carts/${cartId}`)
      .set('X-Customer-Id', 'alice');

    expect(response.status).toBe(200);
    expect(response.body as Cart).toEqual({
      id: cartId,
      status: 'open',
      lines: [],
      lineCount: 0,
      subtotalCents: 0,
    });
  });

  it("answers another customer's cart as not found, exactly as a missing cart", async () => {
    const cartId = await createCartFor('alice');

    const others = await request(database.app)
      .get(`/api/carts/${cartId}`)
      .set('X-Customer-Id', 'bob');
    const missing = await request(database.app)
      .get('/api/carts/0b6f4d1e-7c2a-4f9b-8e3d-5a1c9f0e2b74')
      .set('X-Customer-Id', 'bob');

    expect(others.status).toBe(404);
    expect(others.body).toMatchObject({ status: 404, code: 'CART_NOT_FOUND' });
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ status: 404, code: 'CART_NOT_FOUND' });
    expect((others.body as Problem).title).toBe((missing.body as Problem).title);
    expect((others.body as Problem).detail).toBe((missing.body as Problem).detail);
  });

  it('rejects a cart identifier that is not a UUID with 400 before any lookup', async () => {
    const response = await request(database.app)
      .get('/api/carts/not-a-cart')
      .set('X-Customer-Id', 'alice');

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
  });
});
