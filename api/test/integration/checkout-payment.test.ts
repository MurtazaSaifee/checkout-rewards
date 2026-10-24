import request from 'supertest';
import type { Express } from 'express';
import { describe, expect, it } from 'vitest';
import { useTestDatabase } from '../helpers/test-database.js';
import { createCart, setLine, viewCart } from '../helpers/cart-api.js';
import { checkOut, listMyOrders } from '../helpers/checkout-api.js';
import type { Cart, Order, ProductListing } from '../helpers/api-types.js';

/** Current stock of every product, keyed by product id, read through the public product listing. */
async function productStock(app: Express): Promise<Record<string, number>> {
  const { products } = (await request(app).get('/api/products')).body as ProductListing;
  return Object.fromEntries(products.map((product) => [product.id, product.stock]));
}

describe('paying for a checkout', () => {
  const database = useTestDatabase();

  it('declines tok_decline with 402 PAYMENT_DECLINED, and leaves stock, the cart and the orders unchanged', async () => {
    const cartId = await createCart(database.app, 'alice');
    await setLine(database.app, 'alice', cartId, 'canvas-tote', 2);
    const stockBefore = await productStock(database.app);

    const response = await checkOut(database.app, 'alice', cartId, { paymentToken: 'tok_decline' });
    const cart = (await viewCart(database.app, 'alice', cartId)).body as Cart;

    expect(response.status).toBe(402);
    expect(response.body).toMatchObject({ status: 402, code: 'PAYMENT_DECLINED' });
    expect(await productStock(database.app)).toEqual(stockBefore);
    expect(cart.status).toBe('open');
    expect((await listMyOrders(database.app, 'alice')).body).toEqual({ orders: [] });
  });

  it('checks the same cart out with tok_ok after a decline, and the order takes the next gapless number', async () => {
    // Bob's order is placed first, so Alice's order must take number 2: the declined checkout took none.
    const bobCart = await createCart(database.app, 'bob');
    await setLine(database.app, 'bob', bobCart, 'notebook-set', 1);
    const bob = await checkOut(database.app, 'bob', bobCart);

    const cartId = await createCart(database.app, 'alice');
    await setLine(database.app, 'alice', cartId, 'canvas-tote', 2);
    const declined = await checkOut(database.app, 'alice', cartId, { paymentToken: 'tok_decline' });
    const approved = await checkOut(database.app, 'alice', cartId, { paymentToken: 'tok_ok' });
    const cart = (await viewCart(database.app, 'alice', cartId)).body as Cart;

    expect(bob.status).toBe(201);
    expect(declined.status).toBe(402);
    expect(approved.status).toBe(201);
    expect(approved.body as Order).toMatchObject({ orderNumber: 2, subtotalCents: 3600, totalCents: 3600 });
    expect(cart.status).toBe('checked_out');
  });

  it('refuses a payment token the contract does not list with 400 VALIDATION_FAILED, and changes nothing', async () => {
    const cartId = await createCart(database.app, 'carol');
    await setLine(database.app, 'carol', cartId, 'ceramic-mug', 1);
    const stockBefore = await productStock(database.app);

    const response = await checkOut(database.app, 'carol', cartId, { paymentToken: 'tok_maybe' });
    const cart = (await viewCart(database.app, 'carol', cartId)).body as Cart;

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    expect(await productStock(database.app)).toEqual(stockBefore);
    expect(cart.status).toBe('open');
  });
});

describe('payment tokens and idempotency keys', () => {
  const database = useTestDatabase();

  it('lets the same key succeed after a decline, because a declined checkout stores nothing under its key', async () => {
    const cartId = await createCart(database.app, 'dave');
    await setLine(database.app, 'dave', cartId, 'enamel-bottle', 1);

    const declined = await checkOut(database.app, 'dave', cartId, { idempotencyKey: 'dave-attempt', paymentToken: 'tok_decline' });
    const retried = await checkOut(database.app, 'dave', cartId, { idempotencyKey: 'dave-attempt', paymentToken: 'tok_ok' });

    expect(declined.status).toBe(402);
    expect(retried.status).toBe(201);
    expect(retried.body as Order).toMatchObject({ orderNumber: 1 });
  });

  it('treats a different payment token under a key that placed an order as a different request, and refuses it', async () => {
    const cartId = await createCart(database.app, 'erin');
    await setLine(database.app, 'erin', cartId, 'ceramic-mug', 1);
    const placed = await checkOut(database.app, 'erin', cartId, { idempotencyKey: 'erin-attempt', paymentToken: 'tok_ok' });

    const changed = await checkOut(database.app, 'erin', cartId, { idempotencyKey: 'erin-attempt', paymentToken: 'tok_decline' });

    expect(placed.status).toBe(201);
    expect(changed.status).toBe(422);
    expect(changed.body).toMatchObject({ status: 422, code: 'IDEMPOTENCY_KEY_REUSED' });
  });
});
