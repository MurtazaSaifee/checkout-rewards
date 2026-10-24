import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { useTestDatabase } from '../helpers/test-database.js';
import { createCart, removeLine, setLine, viewCart } from '../helpers/cart-api.js';
import type { Cart, Problem, ProductListing } from '../helpers/api-types.js';

describe('setting a cart line quantity', () => {
  const database = useTestDatabase();

  it('creates a line at the current unit price and reports the line amount, subtotal and line count', async () => {
    const cartId = await createCart(database.app, 'alice');
    await setLine(database.app, 'alice', cartId, 'ceramic-mug', 2);

    const response = await setLine(database.app, 'alice', cartId, 'notebook-set', 1);

    expect(response.status).toBe(200);
    expect(response.body as Cart).toEqual({
      id: cartId,
      status: 'open',
      lines: [
        {
          productId: 'ceramic-mug',
          name: 'Ceramic Mug',
          unitPriceCents: 1200,
          quantity: 2,
          lineAmountCents: 2400,
        },
        {
          productId: 'notebook-set',
          name: 'Notebook Set',
          unitPriceCents: 950,
          quantity: 1,
          lineAmountCents: 950,
        },
      ],
      lineCount: 2,
      subtotalCents: 3350,
    });
  });

  it('replaces the quantity of a line already in the cart rather than adding to it', async () => {
    const cartId = await createCart(database.app, 'alice');
    await setLine(database.app, 'alice', cartId, 'classic-tee', 3);

    const response = await setLine(database.app, 'alice', cartId, 'classic-tee', 5);
    const cart = response.body as Cart;

    expect(response.status).toBe(200);
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]).toMatchObject({ productId: 'classic-tee', quantity: 5, lineAmountCents: 12500 });
    expect(cart.subtotalCents).toBe(12500);
  });

  it('leaves the cart unchanged when the same request is repeated', async () => {
    const cartId = await createCart(database.app, 'alice');
    const first = await setLine(database.app, 'alice', cartId, 'ceramic-mug', 2);

    const second = await setLine(database.app, 'alice', cartId, 'ceramic-mug', 2);
    const viewed = await viewCart(database.app, 'alice', cartId);

    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(viewed.body).toEqual(first.body);
  });

  it('keeps a single line at the requested quantity when identical requests arrive at the same moment', async () => {
    const cartId = await createCart(database.app, 'alice');

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => setLine(database.app, 'alice', cartId, 'ceramic-mug', 2)),
    );
    const cart = (await viewCart(database.app, 'alice', cartId)).body as Cart;

    expect(responses.map((response) => response.status)).toEqual(Array(10).fill(200));
    expect(cart.lines).toEqual([expect.objectContaining({ productId: 'ceramic-mug', quantity: 2 })]);
    expect(cart.lineCount).toBe(1);
  });

  it('prices the cart at the product price in force when the cart is viewed, not when the line was set', async () => {
    const cartId = await createCart(database.app, 'alice');
    await setLine(database.app, 'alice', cartId, 'canvas-tote', 2);

    // Arrange: a price change made directly in the database, as the README describes.
    await database.pool.query(`UPDATE products SET unit_price_cents = 1900 WHERE id = 'canvas-tote'`);
    const cart = (await viewCart(database.app, 'alice', cartId)).body as Cart;

    expect(cart.lines).toEqual([
      {
        productId: 'canvas-tote',
        name: 'Canvas Tote Bag',
        unitPriceCents: 1900,
        quantity: 2,
        lineAmountCents: 3800,
      },
    ]);
    expect(cart.subtotalCents).toBe(3800);
  });

  it('answers a set on a cart that does not exist as not found', async () => {
    const response = await setLine(
      database.app,
      'alice',
      '0b6f4d1e-7c2a-4f9b-8e3d-5a1c9f0e2b74',
      'ceramic-mug',
      1,
    );

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ status: 404, code: 'CART_NOT_FOUND' });
  });

  it('answers a set on another customer\'s cart as not found and changes nothing', async () => {
    const cartId = await createCart(database.app, 'alice');
    await setLine(database.app, 'alice', cartId, 'enamel-bottle', 1);

    const response = await setLine(database.app, 'bob', cartId, 'enamel-bottle', 4);
    const cart = (await viewCart(database.app, 'alice', cartId)).body as Cart;

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ status: 404, code: 'CART_NOT_FOUND' });
    expect(cart.lines).toEqual([expect.objectContaining({ productId: 'enamel-bottle', quantity: 1 })]);
  });

  it.each([
    ['zero', { quantity: 0 }],
    ['a negative number', { quantity: -1 }],
    ['a fraction', { quantity: 1.5 }],
    ['above 99', { quantity: 100 }],
    ['a string', { quantity: '2' }],
    ['no quantity', {}],
    ['an unknown field', { quantity: 1, colour: 'red' }],
  ])('rejects a quantity of %s with 400 VALIDATION_FAILED and changes nothing', async (_label, body) => {
    const cartId = await createCart(database.app, 'alice');

    const response = await request(database.app)
      .put(`/api/carts/${cartId}/lines/ceramic-mug`)
      .set('X-Customer-Id', 'alice')
      .send(body);
    const cart = (await viewCart(database.app, 'alice', cartId)).body as Cart;

    expect(response.status).toBe(400);
    expect(response.body as Problem).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    expect(cart.lines).toEqual([]);
  });

  it('accepts a quantity of 1, and a quantity equal to the stock available', async () => {
    const cartId = await createCart(database.app, 'alice');

    const one = await setLine(database.app, 'alice', cartId, 'classic-tee', 1);
    const equalToStock = await setLine(database.app, 'alice', cartId, 'limited-hoodie', 3);

    expect(one.status).toBe(200);
    expect(equalToStock.status).toBe(200);
  });

  it('does not take stock when a line is set', async () => {
    const cartId = await createCart(database.app, 'alice');

    const response = await setLine(database.app, 'alice', cartId, 'limited-hoodie', 3);
    const { products } = (await request(database.app).get('/api/products')).body as ProductListing;

    expect(response.status).toBe(200);
    expect(products.find((product) => product.id === 'limited-hoodie')?.stock).toBe(3);
  });

  it('answers an unknown product with 404 PRODUCT_NOT_FOUND and changes nothing', async () => {
    const cartId = await createCart(database.app, 'alice');

    const response = await setLine(database.app, 'alice', cartId, 'no-such-product', 1);
    const cart = (await viewCart(database.app, 'alice', cartId)).body as Cart;

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ status: 404, code: 'PRODUCT_NOT_FOUND' });
    expect(cart.lines).toEqual([]);
  });

  it('rejects a quantity above the stock available with 409 INSUFFICIENT_STOCK, naming the available quantity', async () => {
    const cartId = await createCart(database.app, 'alice');

    const response = await setLine(database.app, 'alice', cartId, 'limited-hoodie', 4);
    const cart = (await viewCart(database.app, 'alice', cartId)).body as Cart;

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      status: 409,
      code: 'INSUFFICIENT_STOCK',
      shortLines: [{ productId: 'limited-hoodie', requested: 4, available: 3 }],
    });
    expect(cart.lines).toEqual([]);
  });

  it('treats 99 as a valid quantity and checks it against stock, rather than rejecting it as out of range', async () => {
    const cartId = await createCart(database.app, 'alice');

    const response = await setLine(database.app, 'alice', cartId, 'ceramic-mug', 99);

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      shortLines: [{ productId: 'ceramic-mug', requested: 99, available: 60 }],
    });
  });

  it('checks stock only as a courtesy, so two customers can each set a quantity up to the stock', async () => {
    const aliceCart = await createCart(database.app, 'alice');
    const bobCart = await createCart(database.app, 'bob');

    const alice = await setLine(database.app, 'alice', aliceCart, 'limited-hoodie', 3);
    const bob = await setLine(database.app, 'bob', bobCart, 'limited-hoodie', 3);

    expect(alice.status).toBe(200);
    expect(bob.status).toBe(200);
  });
});

describe('removing a cart line', () => {
  const database = useTestDatabase();

  it('removes the line and returns the cart without it', async () => {
    const cartId = await createCart(database.app, 'alice');
    await setLine(database.app, 'alice', cartId, 'ceramic-mug', 2);
    await setLine(database.app, 'alice', cartId, 'notebook-set', 1);

    const response = await removeLine(database.app, 'alice', cartId, 'ceramic-mug');

    expect(response.status).toBe(200);
    expect(response.body as Cart).toEqual({
      id: cartId,
      status: 'open',
      lines: [
        {
          productId: 'notebook-set',
          name: 'Notebook Set',
          unitPriceCents: 950,
          quantity: 1,
          lineAmountCents: 950,
        },
      ],
      lineCount: 1,
      subtotalCents: 950,
    });
  });

  it('succeeds, returning the cart unchanged, when the line is already gone', async () => {
    const cartId = await createCart(database.app, 'alice');
    await setLine(database.app, 'alice', cartId, 'ceramic-mug', 2);
    const first = await removeLine(database.app, 'alice', cartId, 'ceramic-mug');

    const retried = await removeLine(database.app, 'alice', cartId, 'ceramic-mug');
    const neverAdded = await removeLine(database.app, 'alice', cartId, 'no-such-product');

    expect(retried.status).toBe(200);
    expect(retried.body).toEqual(first.body);
    expect(neverAdded.status).toBe(200);
    expect(neverAdded.body).toEqual(first.body);
  });

  it("answers a removal from another customer's cart as not found and removes nothing", async () => {
    const cartId = await createCart(database.app, 'alice');
    await setLine(database.app, 'alice', cartId, 'ceramic-mug', 2);

    const response = await removeLine(database.app, 'bob', cartId, 'ceramic-mug');
    const cart = (await viewCart(database.app, 'alice', cartId)).body as Cart;

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ status: 404, code: 'CART_NOT_FOUND' });
    expect(cart.lines).toEqual([expect.objectContaining({ productId: 'ceramic-mug', quantity: 2 })]);
  });

  it('answers a removal from a cart that does not exist as not found', async () => {
    const response = await removeLine(
      database.app,
      'alice',
      '0b6f4d1e-7c2a-4f9b-8e3d-5a1c9f0e2b74',
      'ceramic-mug',
    );

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ status: 404, code: 'CART_NOT_FOUND' });
  });

  it('rejects every change to a checked-out cart with 409 CART_ALREADY_CHECKED_OUT and leaves the cart as it was', async () => {
    const cartId = await createCart(database.app, 'alice');
    await setLine(database.app, 'alice', cartId, 'ceramic-mug', 2);
    // Arrange: mark the cart checked out directly. Checkout itself arrives with the
    // checkout ticket, which then exercises this path end to end.
    await database.pool.query(`UPDATE carts SET status = 'checked_out' WHERE id = $1`, [cartId]);

    const set = await setLine(database.app, 'alice', cartId, 'ceramic-mug', 5);
    const removed = await removeLine(database.app, 'alice', cartId, 'ceramic-mug');
    const cart = (await viewCart(database.app, 'alice', cartId)).body as Cart;

    expect(set.status).toBe(409);
    expect(set.body).toMatchObject({ status: 409, code: 'CART_ALREADY_CHECKED_OUT' });
    expect(removed.status).toBe(409);
    expect(removed.body).toMatchObject({ status: 409, code: 'CART_ALREADY_CHECKED_OUT' });
    expect(cart).toMatchObject({
      status: 'checked_out',
      lines: [expect.objectContaining({ productId: 'ceramic-mug', quantity: 2 })],
    });
  });
});
