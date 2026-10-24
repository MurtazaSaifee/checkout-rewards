import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { useTestDatabase } from '../helpers/test-database.js';
import type { ProductListing } from '../helpers/api-types.js';

describe('GET /api/products', () => {
  const database = useTestDatabase();

  it('lists the seeded products with unit price in cents and stock, without an identity header', async () => {
    const response = await request(database.app).get('/api/products');
    const body = response.body as ProductListing;

    expect(response.status).toBe(200);
    expect(body.products).toHaveLength(6);
    expect(body.products).toContainEqual({
      id: 'limited-hoodie',
      name: 'Limited Edition Hoodie',
      unitPriceCents: 8999,
      stock: 3,
    });
  });
});
