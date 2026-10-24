import { Writable } from 'node:stream';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../../src/logging.js';
import { useTestDatabase } from '../helpers/test-database.js';
import { createCart, setLine } from '../helpers/cart-api.js';

/** Captures each log line the service writes, parsed as JSON. */
function captureLogs(): { entries: Array<Record<string, unknown>>; destination: Writable } {
  const entries: Array<Record<string, unknown>> = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line.trim() !== '') entries.push(JSON.parse(line) as Record<string, unknown>);
      }
      callback();
    },
  });
  return { entries, destination };
}

describe('structured request logging', () => {
  const logs = captureLogs();
  const database = useTestDatabase({
    logger: createLogger({ level: 'info', destination: logs.destination }),
  });

  it('writes JSON lines, and every line for a request carries its request identifier', async () => {
    await request(database.app)
      .get('/api/products?colour=red')
      .set('X-Request-Id', 'log-check-1');

    const forRequest = logs.entries.filter((entry) => entry.requestId === 'log-check-1');
    expect(forRequest.length).toBeGreaterThanOrEqual(2);
    expect(forRequest).toContainEqual(
      expect.objectContaining({ msg: 'request rejected', code: 'VALIDATION_FAILED' }),
    );
    expect(forRequest).toContainEqual(
      expect.objectContaining({
        msg: 'request completed',
        method: 'GET',
        path: '/api/products',
        status: 400,
      }),
    );
  });

  it('records the full path of a request that a router handles', async () => {
    await request(database.app).get('/api/products').set('X-Request-Id', 'log-check-2');

    expect(logs.entries).toContainEqual(
      expect.objectContaining({
        msg: 'request completed',
        requestId: 'log-check-2',
        path: '/api/products',
        status: 200,
      }),
    );
  });
});

describe('checkout outcome logging', () => {
  const logs = captureLogs();
  const database = useTestDatabase({
    logger: createLogger({ level: 'info', destination: logs.destination }),
  });

  it('logs every checkout outcome once, with its code: the placed order, the replay, and the refusal', async () => {
    const cartId = await createCart(database.app, 'alice');
    await setLine(database.app, 'alice', cartId, 'ceramic-mug', 1);
    const checkoutPath = `/api/carts/${cartId}/checkout`;
    await request(database.app)
      .post(checkoutPath)
      .set('X-Customer-Id', 'alice')
      .set('Idempotency-Key', 'outcome-key')
      .set('X-Request-Id', 'outcome-placed-1');
    await request(database.app)
      .post(checkoutPath)
      .set('X-Customer-Id', 'alice')
      .set('Idempotency-Key', 'outcome-key')
      .set('X-Request-Id', 'outcome-replayed-1');

    const emptyCartId = await createCart(database.app, 'bob');
    await request(database.app)
      .post(`/api/carts/${emptyCartId}/checkout`)
      .set('X-Customer-Id', 'bob')
      .set('Idempotency-Key', 'outcome-key')
      .set('X-Request-Id', 'outcome-refused-1');

    const outcomesOf = (requestId: string) =>
      logs.entries.filter((entry) => entry.requestId === requestId && entry.msg === 'checkout outcome');
    expect(outcomesOf('outcome-placed-1')).toEqual([
      expect.objectContaining({ code: 'ORDER_PLACED', status: 201, orderNumber: 1 }),
    ]);
    expect(outcomesOf('outcome-replayed-1')).toEqual([
      expect.objectContaining({ code: 'IDEMPOTENT_REPLAY', status: 201, orderNumber: 1 }),
    ]);
    expect(outcomesOf('outcome-refused-1')).toEqual([
      expect.objectContaining({ code: 'CART_EMPTY', status: 422 }),
    ]);
    // The refusal is logged once, as the checkout's outcome, not again as a rejected request.
    expect(
      logs.entries.filter((entry) => entry.requestId === 'outcome-refused-1' && entry.msg === 'request rejected'),
    ).toEqual([]);
  });
});
