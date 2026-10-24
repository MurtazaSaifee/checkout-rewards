import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { useTestDatabase } from '../helpers/test-database.js';
import type { Problem } from '../helpers/api-types.js';

const GENERATED_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('request identifiers', () => {
  const database = useTestDatabase();

  it('echoes a valid client identifier on success and in error bodies', async () => {
    const success = await request(database.app)
      .get('/api/products')
      .set('X-Request-Id', 'client-req-42');
    expect(success.headers['x-request-id']).toBe('client-req-42');

    const failure = await request(database.app)
      .get('/api/products?colour=red')
      .set('X-Request-Id', 'client-req-43');
    expect(failure.headers['x-request-id']).toBe('client-req-43');
    expect((failure.body as Problem).requestId).toBe('client-req-43');
  });

  it('generates an identifier when the client sends none, and repeats it in the error body', async () => {
    const response = await request(database.app).get('/api/products?colour=red');
    const body = response.body as Problem;

    expect(response.headers['x-request-id']).toMatch(GENERATED_ID);
    expect(body.requestId).toBe(response.headers['x-request-id']);
  });

  it.each([
    ['contains spaces', 'spaces are not allowed here'],
    ['exceeds 128 characters', 'a'.repeat(129)],
  ])('replaces a client identifier that %s with a generated one', async (_label, value) => {
    const response = await request(database.app)
      .get('/api/products')
      .set('X-Request-Id', value);

    expect(response.headers['x-request-id']).toMatch(GENERATED_ID);
  });
});
