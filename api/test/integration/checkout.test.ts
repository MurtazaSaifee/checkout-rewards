import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { useTestDatabase } from '../helpers/test-database.js';
import { createCart, setLine, viewCart } from '../helpers/cart-api.js';
import { checkOut, listMyOrders, viewOrder } from '../helpers/checkout-api.js';
import type { Cart, Order, Problem, ProductListing } from '../helpers/api-types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MISSING_CART = '0b6f4d1e-7c2a-4f9b-8e3d-5a1c9f0e2b74';
const MISSING_ORDER = '0b6f4d1e-7c2a-4f9b-8e3d-5a1c9f0e2b74';

/** Current stock of every product, keyed by product id, read through the public product listing. */
async function productStock(app: Express): Promise<Record<string, number>> {
  const { products } = (await request(app).get('/api/products')).body as ProductListing;
  return Object.fromEntries(products.map((product) => [product.id, product.stock]));
}

describe('checking out a cart', () => {
  const database = useTestDatabase();

  it('places an order with each line, the subtotal and the total at current prices, and returns 201', async () => {
    const cartId = await createCart(database.app, 'alice');
    await setLine(database.app, 'alice', cartId, 'ceramic-mug', 2);
    await setLine(database.app, 'alice', cartId, 'notebook-set', 1);

    const response = await checkOut(database.app, 'alice', cartId);

    expect(response.status).toBe(201);
    const { id, placedAt, ...order } = response.body as Order;
    expect(id).toMatch(UUID);
    expect(Date.parse(placedAt)).not.toBeNaN();
    expect(order).toEqual({
      orderNumber: 1,
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
      subtotalCents: 3350,
      couponCode: null,
      couponPercentOff: null,
      discountCents: 0,
      totalCents: 3350,
    });
  });

  it('answers a cart that does not exist with 404 CART_NOT_FOUND', async () => {
    const response = await checkOut(database.app, 'alice', MISSING_CART);

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ status: 404, code: 'CART_NOT_FOUND' });
  });

  it("answers another customer's cart with the same 404 as a missing cart, and changes nothing", async () => {
    const cartId = await createCart(database.app, 'alice');
    await setLine(database.app, 'alice', cartId, 'enamel-bottle', 1);

    const response = await checkOut(database.app, 'bob', cartId);
    const cart = (await viewCart(database.app, 'alice', cartId)).body as Cart;

    expect(response.status).toBe(404);
    expect(response.body as Problem).toMatchObject({ status: 404, code: 'CART_NOT_FOUND' });
    expect(cart).toMatchObject({ status: 'open', lineCount: 1 });
  });

  it('refuses to check out an empty cart with 422 CART_EMPTY, and the cart stays open', async () => {
    const cartId = await createCart(database.app, 'alice');

    const response = await checkOut(database.app, 'alice', cartId);
    const cart = (await viewCart(database.app, 'alice', cartId)).body as Cart;

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ status: 422, code: 'CART_EMPTY' });
    expect(cart.status).toBe('open');
  });

  it('refuses a second checkout of a cart with 409 CART_ALREADY_CHECKED_OUT, and places no second order', async () => {
    const cartId = await createCart(database.app, 'alice');
    await setLine(database.app, 'alice', cartId, 'ceramic-mug', 1);
    const first = await checkOut(database.app, 'alice', cartId);

    const second = await checkOut(database.app, 'alice', cartId);

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ status: 409, code: 'CART_ALREADY_CHECKED_OUT' });
  });

  it('takes the stock of each line, so the product stock falls by the quantity ordered', async () => {
    const cartId = await createCart(database.app, 'alice');
    await setLine(database.app, 'alice', cartId, 'canvas-tote', 2);
    await setLine(database.app, 'alice', cartId, 'notebook-set', 3);
    const before = await productStock(database.app);

    await checkOut(database.app, 'alice', cartId);
    const after = await productStock(database.app);

    expect(after['canvas-tote']).toBe(before['canvas-tote']! - 2);
    expect(after['notebook-set']).toBe(before['notebook-set']! - 3);
    expect(after['ceramic-mug']).toBe(before['ceramic-mug']);
  });

  it('refuses with 409 INSUFFICIENT_STOCK listing every short line, and changes nothing', async () => {
    const bobCart = await createCart(database.app, 'bob');
    await setLine(database.app, 'bob', bobCart, 'canvas-tote', 2);
    await setLine(database.app, 'bob', bobCart, 'classic-tee', 2);
    await setLine(database.app, 'bob', bobCart, 'limited-hoodie', 3);
    // Alice buys most of the tees and two hoodies after Bob's cart was filled, so
    // both of Bob's larger lines are now short, and his tote line is not.
    const aliceCart = await createCart(database.app, 'alice');
    await setLine(database.app, 'alice', aliceCart, 'classic-tee', 39);
    await setLine(database.app, 'alice', aliceCart, 'limited-hoodie', 2);
    expect((await checkOut(database.app, 'alice', aliceCart)).status).toBe(201);
    const before = await productStock(database.app);

    const response = await checkOut(database.app, 'bob', bobCart);
    const cart = (await viewCart(database.app, 'bob', bobCart)).body as Cart;

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      status: 409,
      code: 'INSUFFICIENT_STOCK',
      shortLines: [
        { productId: 'classic-tee', requested: 2, available: 1 },
        { productId: 'limited-hoodie', requested: 3, available: 1 },
      ],
    });
    expect(await productStock(database.app)).toEqual(before);
    expect(cart.status).toBe('open');
  });

  it('marks the cart as checked out, so a later edit is rejected', async () => {
    const cartId = await createCart(database.app, 'alice');
    await setLine(database.app, 'alice', cartId, 'ceramic-mug', 1);
    await checkOut(database.app, 'alice', cartId);

    const cart = (await viewCart(database.app, 'alice', cartId)).body as Cart;
    const edit = await setLine(database.app, 'alice', cartId, 'ceramic-mug', 2);

    expect(cart.status).toBe('checked_out');
    expect(edit.status).toBe(409);
    expect(edit.body).toMatchObject({ code: 'CART_ALREADY_CHECKED_OUT' });
  });
});

describe('order numbers', () => {
  const database = useTestDatabase();

  it('gives the placed orders the numbers 1 to k with no gaps, because a failed checkout never takes a number', async () => {
    const cartWith = async (customerId: string, lines: Array<[string, number]>) => {
      const cartId = await createCart(database.app, customerId);
      for (const [productId, quantity] of lines) {
        await setLine(database.app, customerId, cartId, productId, quantity);
      }
      return cartId;
    };

    // Every cart is filled before any checkout runs, because a line is refused at
    // the time it is set when stock is already gone. Carol and Dave both want the
    // last three hoodies, so Dave's checkout fails for stock.
    const alice = await cartWith('alice', [['ceramic-mug', 1]]);
    const bob = await cartWith('bob', []);
    const carol = await cartWith('carol', [['limited-hoodie', 3]]);
    const dave = await cartWith('dave', [['limited-hoodie', 3]]);
    const erin = await cartWith('erin', [['notebook-set', 1]]);

    const first = await checkOut(database.app, 'alice', alice);
    const empty = await checkOut(database.app, 'bob', bob);
    const placedForCarol = await checkOut(database.app, 'carol', carol);
    const refusedForDave = await checkOut(database.app, 'dave', dave);
    const placedForErin = await checkOut(database.app, 'erin', erin);

    expect(empty.status).toBe(422);
    expect(refusedForDave.status).toBe(409);
    const placed = [first, placedForCarol, placedForErin];
    expect(placed.map((response) => response.status)).toEqual([201, 201, 201]);
    expect(placed.map((response) => (response.body as Order).orderNumber)).toEqual([1, 2, 3]);
  });
});

describe('viewing orders', () => {
  const database = useTestDatabase();

  /** Fills a cart for the customer, checks it out and returns the order the checkout placed. */
  async function placeOrder(customerId: string, lines: Array<[string, number]>): Promise<Order> {
    const cartId = await createCart(database.app, customerId);
    for (const [productId, quantity] of lines) {
      await setLine(database.app, customerId, cartId, productId, quantity);
    }
    const response = await checkOut(database.app, customerId, cartId);
    expect(response.status).toBe(201);
    return response.body as Order;
  }

  it('shows an order to the customer who placed it, exactly as the checkout returned it', async () => {
    const placed = await placeOrder('alice', [['ceramic-mug', 2], ['notebook-set', 1]]);

    const response = await viewOrder(database.app, 'alice', placed.id);

    expect(response.status).toBe(200);
    expect(response.body as Order).toEqual(placed);
  });

  it("answers another customer's order with the same 404 as a missing order", async () => {
    const placed = await placeOrder('alice', [['enamel-bottle', 1]]);

    const others = await viewOrder(database.app, 'bob', placed.id);
    const missing = await viewOrder(database.app, 'bob', MISSING_ORDER);

    expect(others.status).toBe(404);
    expect(others.body).toMatchObject({ status: 404, code: 'ORDER_NOT_FOUND' });
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ status: 404, code: 'ORDER_NOT_FOUND' });
    expect((others.body as Problem).title).toBe((missing.body as Problem).title);
    expect((others.body as Problem).detail).toBe((missing.body as Problem).detail);
  });

  it('keeps each line name, price and the totals as they were at checkout, after the product changes', async () => {
    const placed = await placeOrder('alice', [['canvas-tote', 2]]);

    await database.pool.query(
      `UPDATE products SET unit_price_cents = 2500, name = 'Renamed Tote' WHERE id = 'canvas-tote'`,
    );
    const response = await viewOrder(database.app, 'alice', placed.id);

    expect(response.status).toBe(200);
    expect(response.body as Order).toEqual(placed);
    expect(placed.lines).toEqual([
      {
        productId: 'canvas-tote',
        name: 'Canvas Tote Bag',
        unitPriceCents: 1800,
        quantity: 2,
        lineAmountCents: 3600,
      },
    ]);
  });

  it('answers an order identifier that is not a UUID with 400 VALIDATION_FAILED', async () => {
    const response = await viewOrder(database.app, 'alice', 'not-an-order');

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
  });

  it("lists only the calling customer's orders, in order-number order", async () => {
    // Fresh identifiers: the orders placed by the tests above belong to other customers.
    const lister = 'lister-alice';
    const otherLister = 'lister-bob';
    const nobody = 'lister-carol';
    const listersFirst = await placeOrder(lister, [['ceramic-mug', 1]]);
    const othersOnly = await placeOrder(otherLister, [['notebook-set', 1]]);
    const listersSecond = await placeOrder(lister, [['enamel-bottle', 1]]);

    const mine = await listMyOrders(database.app, lister);
    const theirs = await listMyOrders(database.app, otherLister);
    const none = await listMyOrders(database.app, nobody);

    expect(mine.status).toBe(200);
    expect(mine.body).toEqual({ orders: [listersFirst, listersSecond] });
    expect(theirs.body).toEqual({ orders: [othersOnly] });
    expect(none.body).toEqual({ orders: [] });
  });
});

describe('a cart edit racing a checkout', () => {
  const database = useTestDatabase();

  it('is either included in the order or rejected, and the cart and the order always agree', async () => {
    for (let round = 0; round < 20; round++) {
      const customerId = `racer-${round}`;
      const cartId = await createCart(database.app, customerId);
      await setLine(database.app, customerId, cartId, 'classic-tee', 1);

      const [edit, checkout] = await Promise.all([
        setLine(database.app, customerId, cartId, 'ceramic-mug', 2),
        checkOut(database.app, customerId, cartId),
      ]);
      const cart = (await viewCart(database.app, customerId, cartId)).body as Cart;

      expect(checkout.status).toBe(201);
      const order = checkout.body as Order;
      if (edit.status === 200) {
        // The edit committed first, so the order must contain the mug.
        expect(order.lines.map((line) => line.productId)).toEqual(['ceramic-mug', 'classic-tee']);
      } else {
        // The checkout committed first, so the edit must have been rejected and the order must not contain the mug.
        expect(edit.status).toBe(409);
        expect(edit.body).toMatchObject({ code: 'CART_ALREADY_CHECKED_OUT' });
        expect(order.lines.map((line) => line.productId)).toEqual(['classic-tee']);
      }
      expect(cart).toMatchObject({ status: 'checked_out' });
      expect(cart.lines).toEqual(order.lines);
    }
  });
});

describe('simultaneous checkouts', () => {
  const database = useTestDatabase();

  it('lets exactly as many checkouts succeed as stock allows, fails the rest with INSUFFICIENT_STOCK, and leaves stock at zero', async () => {
    const customers = Array.from({ length: 8 }, (_, index) => `racer-${index}`);
    const carts: string[] = [];
    for (const customerId of customers) {
      const cartId = await createCart(database.app, customerId);
      await setLine(database.app, customerId, cartId, 'limited-hoodie', 1);
      carts.push(cartId);
    }

    const responses = await Promise.all(
      customers.map((customerId, index) => checkOut(database.app, customerId, carts[index]!)),
    );

    const placed = responses.filter((response) => response.status === 201);
    const refused = responses.filter((response) => response.status === 409);
    expect(placed).toHaveLength(3);
    expect(refused).toHaveLength(5);
    for (const response of refused) {
      expect(response.body).toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    }
    expect(placed.map((response) => (response.body as Order).orderNumber).sort()).toEqual([1, 2, 3]);
    const { products } = (await request(database.app).get('/api/products')).body as ProductListing;
    expect(products.find((product) => product.id === 'limited-hoodie')?.stock).toBe(0);
  });
});
