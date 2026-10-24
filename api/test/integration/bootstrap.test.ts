import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { bootstrapDatabase } from '../../src/db/bootstrap.js';
import { useTestDatabase } from '../helpers/test-database.js';
import type { ProductListing } from '../helpers/api-types.js';

describe('startup against an existing database', () => {
  const database = useTestDatabase();

  it('keeps six products and any stock already changed when the service starts again', async () => {
    // Arrange: a reviewer has changed stock directly in the database.
    await database.pool.query(`UPDATE products SET stock = 0 WHERE id = 'ceramic-mug'`);

    // Act: the same startup path the server runs on every boot.
    await bootstrapDatabase(database.pool);

    // Assert: observed through the API only.
    const response = await request(database.app).get('/api/products');
    const { products } = response.body as ProductListing;
    expect(products).toHaveLength(6);
    expect(products.find((p) => p.id === 'ceramic-mug')?.stock).toBe(0);
  });
});
