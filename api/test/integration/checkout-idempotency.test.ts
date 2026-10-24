import request from 'supertest';
import type { Express } from 'express';
import { describe, expect, it } from 'vitest';
import { useTestDatabase } from '../helpers/test-database.js';
import { createCart, setLine, viewCart } from '../helpers/cart-api.js';
import { checkOut, listMyOrders } from '../helpers/checkout-api.js';
import type { Cart, Order, Problem, ProductListing } from '../helpers/api-types.js';

/** Stock of one product, read through the public product listing. */
async function stockOf(app: Express, productId: string): Promise<number> {
  const { products } = (await request(app).get('/api/products')).body as ProductListing;
  const product = products.find((candidate) => candidate.id === productId);
  if (product === undefined) {
    throw new Error(`no product ${productId}`);
  }
  return product.stock;
}

/** The orders a customer can see. Order numbers are shared by every customer, so only the count is checked. */
async function ordersOf(app: Express, customerId: string): Promise<Order[]> {
  return ((await listMyOrders(app, customerId)).body as { orders: Order[] }).orders;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

describe('checkout idempotency keys', () => {
  const database = useTestDatabase();

  it('refuses a checkout without an Idempotency-Key with 400 IDEMPOTENCY_KEY_REQUIRED, and changes nothing', async () => {
    const cartId = await createCart(database.app, 'no-key');
    await setLine(database.app, 'no-key', cartId, 'ceramic-mug', 1);

    const missing = await request(database.app)
      .post(`/api/carts/${cartId}/checkout`)
      .set('X-Customer-Id', 'no-key');
    const blank = await request(database.app)
      .post(`/api/carts/${cartId}/checkout`)
      .set('X-Customer-Id', 'no-key')
      .set('Idempotency-Key', '');
    const cart = (await viewCart(database.app, 'no-key', cartId)).body as Cart;

    expect(missing.status).toBe(400);
    expect(missing.body).toMatchObject({ status: 400, code: 'IDEMPOTENCY_KEY_REQUIRED' });
    expect(blank.status).toBe(400);
    expect(blank.body).toMatchObject({ status: 400, code: 'IDEMPOTENCY_KEY_REQUIRED' });
    expect(cart.status).toBe('open');
  });

  it('answers a key with characters outside the allowed set with 400 VALIDATION_FAILED', async () => {
    const cartId = await createCart(database.app, 'bad-key');
    await setLine(database.app, 'bad-key', cartId, 'ceramic-mug', 1);

    const response = await checkOut(database.app, 'bad-key', cartId, 'has spaces in it');

    expect(response.status).toBe(400);
    expect(response.body as Problem).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
  });

  it('treats the same key from two customers as two independent keys', async () => {
    const aliceCart = await createCart(database.app, 'key-alice');
    await setLine(database.app, 'key-alice', aliceCart, 'notebook-set', 1);
    const bobCart = await createCart(database.app, 'key-bob');
    await setLine(database.app, 'key-bob', bobCart, 'notebook-set', 1);

    const alice = await checkOut(database.app, 'key-alice', aliceCart, 'shared-key');
    const bob = await checkOut(database.app, 'key-bob', bobCart, 'shared-key');

    expect(alice.status).toBe(201);
    expect(bob.status).toBe(201);
    expect((bob.body as Order).id).not.toBe((alice.body as Order).id);
    expect((bob.body as Order).orderNumber).not.toBe((alice.body as Order).orderNumber);
  });

  it('replays the original status and body for the same key and request, even once the cart is checked out', async () => {
    const cartId = await createCart(database.app, 'replayer');
    await setLine(database.app, 'replayer', cartId, 'canvas-tote', 1);
    const stockBefore = await stockOf(database.app, 'canvas-tote');

    const first = await checkOut(database.app, 'replayer', cartId, 'replay-key');
    const retry = await checkOut(database.app, 'replayer', cartId, 'replay-key');

    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.text).toBe(first.text);
    expect((await listMyOrders(database.app, 'replayer')).body).toEqual({ orders: [first.body] });
    expect(await stockOf(database.app, 'canvas-tote')).toBe(stockBefore - 1);
  });

  it('rejects a key reused for a different cart with 422 IDEMPOTENCY_KEY_REUSED, and places no order', async () => {
    const firstCart = await createCart(database.app, 'reuser');
    await setLine(database.app, 'reuser', firstCart, 'ceramic-mug', 1);
    expect((await checkOut(database.app, 'reuser', firstCart, 'reused-key')).status).toBe(201);

    const secondCart = await createCart(database.app, 'reuser');
    await setLine(database.app, 'reuser', secondCart, 'notebook-set', 1);
    const response = await checkOut(database.app, 'reuser', secondCart, 'reused-key');
    const cart = (await viewCart(database.app, 'reuser', secondCart)).body as Cart;

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ status: 422, code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(cart.status).toBe('open');
    expect(await ordersOf(database.app, 'reuser')).toHaveLength(1);
  });

  it('makes a retry that arrives while the first attempt is still running wait for it, then replays its response', async () => {
    const cartId = await createCart(database.app, 'waiter');
    await setLine(database.app, 'waiter', cartId, 'ceramic-mug', 1);

    // Holding the cart lock stops the first attempt part way through, after it has
    // claimed its key and before it can finish. The retry is sent while it is stuck.
    const holder = await database.pool.connect();
    let committed = false;
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM carts WHERE id = $1 FOR UPDATE', [cartId]);

      const firstAttempt = checkOut(database.app, 'waiter', cartId, 'running-key');
      let retryFinished = false;
      const retry = checkOut(database.app, 'waiter', cartId, 'running-key').then((response) => {
        retryFinished = true;
        return response;
      });
      await sleep(300);
      expect(retryFinished).toBe(false);

      await holder.query('COMMIT');
      committed = true;
      const [first, second] = await Promise.all([firstAttempt, retry]);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.text).toBe(first.text);
    } finally {
      if (!committed) {
        await holder.query('ROLLBACK');
      }
      holder.release();
    }

    expect(await ordersOf(database.app, 'waiter')).toHaveLength(1);
  });

  it('places one order when ten simultaneous checkouts share a key, takes the stock once, and returns identical responses', async () => {
    const cartId = await createCart(database.app, 'ten-way');
    await setLine(database.app, 'ten-way', cartId, 'enamel-bottle', 2);
    const stockBefore = await stockOf(database.app, 'enamel-bottle');

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => checkOut(database.app, 'ten-way', cartId, 'ten-way-key')),
    );

    expect(responses.map((response) => response.status)).toEqual(Array<number>(10).fill(201));
    expect(new Set(responses.map((response) => response.text)).size).toBe(1);
    expect(await ordersOf(database.app, 'ten-way')).toHaveLength(1);
    expect(await stockOf(database.app, 'enamel-bottle')).toBe(stockBefore - 2);
  });

  it('leaves no record of a checkout that failed for an empty cart, so the same key is evaluated again after a fix', async () => {
    const cartId = await createCart(database.app, 'empty-retrier');

    const refused = await checkOut(database.app, 'empty-retrier', cartId, 'empty-key');
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ code: 'CART_EMPTY' });

    await setLine(database.app, 'empty-retrier', cartId, 'ceramic-mug', 1);
    const retry = await checkOut(database.app, 'empty-retrier', cartId, 'empty-key');

    expect(retry.status).toBe(201);
  });

  it('leaves no record of a checkout refused for stock, so the same key is evaluated again once stock returns', async () => {
    const cartId = await createCart(database.app, 'stock-retrier');
    await setLine(database.app, 'stock-retrier', cartId, 'limited-hoodie', 3);
    // Another customer takes two of the three hoodies after the line was set.
    const rivalCart = await createCart(database.app, 'stock-rival');
    await setLine(database.app, 'stock-rival', rivalCart, 'limited-hoodie', 2);
    expect((await checkOut(database.app, 'stock-rival', rivalCart)).status).toBe(201);

    const refused = await checkOut(database.app, 'stock-retrier', cartId, 'stock-key');
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'INSUFFICIENT_STOCK' });

    // Restocking is an arrangement made directly in the database, as the README describes.
    await database.pool.query("UPDATE products SET stock = stock + 5 WHERE id = 'limited-hoodie'");
    const retry = await checkOut(database.app, 'stock-retrier', cartId, 'stock-key');

    expect(retry.status).toBe(201);
  });

  it('refuses a new key on a cart that is already checked out with 409 CART_ALREADY_CHECKED_OUT', async () => {
    const cartId = await createCart(database.app, 'once-only');
    await setLine(database.app, 'once-only', cartId, 'canvas-tote', 1);
    expect((await checkOut(database.app, 'once-only', cartId, 'first-attempt')).status).toBe(201);

    const second = await checkOut(database.app, 'once-only', cartId, 'second-attempt');

    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ status: 409, code: 'CART_ALREADY_CHECKED_OUT' });
    expect(await ordersOf(database.app, 'once-only')).toHaveLength(1);
  });
});
