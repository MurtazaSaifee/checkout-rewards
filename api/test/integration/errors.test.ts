import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { useTestDatabase } from '../helpers/test-database.js';
import type { Problem } from '../helpers/api-types.js';

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

  it('answers a path outside the API with 404 Problem Details rather than an HTML page', async () => {
    const response = await request(database.app).get('/no-such-page');
    const body = response.body as Problem;

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(body).toMatchObject({ status: 404, code: 'ROUTE_NOT_FOUND' });
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
});
