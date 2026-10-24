import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { describe, expect, it } from 'vitest';
import { useTestDatabase } from '../helpers/test-database.js';
import { createCart, setLine, viewCart } from '../helpers/cart-api.js';
import { checkOut, listMyOrders } from '../helpers/checkout-api.js';
import type { Cart, ProductListing } from '../helpers/api-types.js';

/** Current stock of every product, keyed by product id, read through the public product listing. */
async function productStock(app: Express): Promise<Record<string, number>> {
  const { products } = (await request(app).get('/api/products')).body as ProductListing;
  return Object.fromEntries(products.map((product) => [product.id, product.stock]));
}

/** Checks a cart out with an expected total in the body, under a fresh key unless the test names one. */
function checkOutExpecting(
  app: Express,
  customerId: string,
  cartId: string,
  expectedTotalCents: number,
  options: { idempotencyKey?: string; paymentToken?: string } = {},
) {
  return request(app)
    .post(`/api/carts/${cartId}/checkout`)
    .set('X-Customer-Id', customerId)
    .set('Idempotency-Key', options.idempotencyKey ?? randomUUID())
    .send({
      expectedTotalCents,
      ...(options.paymentToken === undefined ? {} : { paymentToken: options.paymentToken }),
    });
}

describe('checking out at the total the customer saw', () => {
  const database = useTestDatabase();

  it('refuses an expected total that differs from the current total with 409 PRICE_CHANGED and the current total, and changes nothing', async () => {
    const cartId = await createCart(database.app, 'alice');
    await setLine(database.app, 'alice', cartId, 'canvas-tote', 2);
    const stockBefore = await productStock(database.app);

    // Two canvas totes at 1800 cents each: the customer saw 3000, which is not the current 3600.
    const response = await checkOutExpecting(database.app, 'alice', cartId, 3000);
    const cart = (await viewCart(database.app, 'alice', cartId)).body as Cart;

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ status: 409, code: 'PRICE_CHANGED', currentTotalCents: 3600 });
    expect(await productStock(database.app)).toEqual(stockBefore);
    expect(cart.status).toBe('open');
    expect((await listMyOrders(database.app, 'alice')).body).toEqual({ orders: [] });
  });

  it('places the order when the expected total matches, and at current prices when no expected total is sent', async () => {
    const cartId = await createCart(database.app, 'bob');
    await setLine(database.app, 'bob', cartId, 'canvas-tote', 2);

    const matching = await checkOutExpecting(database.app, 'bob', cartId, 3600);

    expect(matching.status).toBe(201);
    expect(matching.body).toMatchObject({ subtotalCents: 3600, totalCents: 3600 });

    const unguardedCart = await createCart(database.app, 'bob');
    await setLine(database.app, 'bob', unguardedCart, 'notebook-set', 1);

    const unguarded = await checkOut(database.app, 'bob', unguardedCart);

    expect(unguarded.status).toBe(201);
    expect(unguarded.body).toMatchObject({ subtotalCents: 950, totalCents: 950 });
  });

  it('refuses a checkout at the total seen before a price changed, then places it at the new total', async () => {
    const cartId = await createCart(database.app, 'carol');
    await setLine(database.app, 'carol', cartId, 'enamel-bottle', 2);
    const seen = (await viewCart(database.app, 'carol', cartId)).body as Cart;
    // Two enamel bottles at the seeded 1650 cents each.
    expect(seen.subtotalCents).toBe(3300);

    // A product's price is changed directly in the database, between the cart view and the checkout.
    await database.pool.query("UPDATE products SET unit_price_cents = 2000 WHERE id = 'enamel-bottle'");
    const stockBefore = await productStock(database.app);

    const refused = await checkOutExpecting(database.app, 'carol', cartId, seen.subtotalCents);
    const cartAfterRefusal = (await viewCart(database.app, 'carol', cartId)).body as Cart;

    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ status: 409, code: 'PRICE_CHANGED', currentTotalCents: 4000 });
    expect(await productStock(database.app)).toEqual(stockBefore);
    expect(cartAfterRefusal.status).toBe('open');

    const retried = await checkOutExpecting(database.app, 'carol', cartId, 4000);

    expect(retried.status).toBe(201);
    expect(retried.body).toMatchObject({
      subtotalCents: 4000,
      totalCents: 4000,
      lines: [
        {
          productId: 'enamel-bottle',
          name: 'Enamel Water Bottle',
          unitPriceCents: 2000,
          quantity: 2,
          lineAmountCents: 4000,
        },
      ],
    });
  });

  it('takes no order number for a refused price change, so the next placed order follows the last one with no gap', async () => {
    const before = await createCart(database.app, 'dan');
    await setLine(database.app, 'dan', before, 'ceramic-mug', 1);
    const placedBefore = await checkOut(database.app, 'dan', before);

    const cartId = await createCart(database.app, 'erin');
    await setLine(database.app, 'erin', cartId, 'ceramic-mug', 1);
    const refused = await checkOutExpecting(database.app, 'erin', cartId, 1000);

    const after = await createCart(database.app, 'frank');
    await setLine(database.app, 'frank', after, 'ceramic-mug', 1);
    const placedAfter = await checkOut(database.app, 'frank', after);

    expect(refused.status).toBe(409);
    expect(placedBefore.status).toBe(201);
    expect(placedAfter.status).toBe(201);
    expect((placedAfter.body as { orderNumber: number }).orderNumber).toBe(
      (placedBefore.body as { orderNumber: number }).orderNumber + 1,
    );
  });

  it('answers a changed price with PRICE_CHANGED before the payment is tried, so a declined token is refused for the price, not charged', async () => {
    const cartId = await createCart(database.app, 'gina');
    await setLine(database.app, 'gina', cartId, 'notebook-set', 1);

    const response = await checkOutExpecting(database.app, 'gina', cartId, 900, { paymentToken: 'tok_decline' });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ status: 409, code: 'PRICE_CHANGED', currentTotalCents: 950 });
  });

  it('releases the idempotency key of a refused price change, so the same key checks out at the new total', async () => {
    const cartId = await createCart(database.app, 'hana');
    await setLine(database.app, 'hana', cartId, 'notebook-set', 1);

    const refused = await checkOutExpecting(database.app, 'hana', cartId, 900, { idempotencyKey: 'hana-attempt' });
    const retried = await checkOutExpecting(database.app, 'hana', cartId, 950, { idempotencyKey: 'hana-attempt' });

    expect(refused.status).toBe(409);
    expect(retried.status).toBe(201);
    expect(retried.body).toMatchObject({ totalCents: 950 });
  });

  it('treats a different expected total under a key that placed an order as a different request, and refuses it', async () => {
    const cartId = await createCart(database.app, 'ivan');
    await setLine(database.app, 'ivan', cartId, 'notebook-set', 2);
    const placed = await checkOutExpecting(database.app, 'ivan', cartId, 1900, { idempotencyKey: 'ivan-attempt' });

    const changed = await checkOutExpecting(database.app, 'ivan', cartId, 1800, { idempotencyKey: 'ivan-attempt' });

    expect(placed.status).toBe(201);
    expect(changed.status).toBe(422);
    expect(changed.body).toMatchObject({ status: 422, code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('refuses an expected total that is not a whole number of cents or is negative with 400 VALIDATION_FAILED, and changes nothing', async () => {
    const cartId = await createCart(database.app, 'judy');
    await setLine(database.app, 'judy', cartId, 'ceramic-mug', 1);

    for (const expectedTotalCents of [-1, 12.5, '1200']) {
      const response = await request(database.app)
        .post(`/api/carts/${cartId}/checkout`)
        .set('X-Customer-Id', 'judy')
        .set('Idempotency-Key', randomUUID())
        .send({ expectedTotalCents });

      expect(response.status, `expectedTotalCents ${JSON.stringify(expectedTotalCents)}`).toBe(400);
      expect(response.body).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    }
    expect(((await viewCart(database.app, 'judy', cartId)).body as Cart).status).toBe('open');
  });
});
