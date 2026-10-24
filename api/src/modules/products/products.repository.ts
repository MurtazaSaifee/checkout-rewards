import type { Pool, PoolClient } from 'pg';
import type { SqlRunner } from '../../db/transaction.js';

export interface Product {
  id: string;
  name: string;
  unitPriceCents: number;
  stock: number;
}

/** Every product with its current price and stock, in a stable order. */
export async function listProducts(db: Pool): Promise<Product[]> {
  const { rows } = await db.query<Product>(
    `SELECT id, name, unit_price_cents AS "unitPriceCents", stock
       FROM products
      ORDER BY id`,
  );
  return rows;
}

/**
 * Takes units of a product from stock in one conditional update. The stock falls
 * only if enough remains, so concurrent checkouts can never take more than
 * exists: the second one waits on the row lock and then finds too little left.
 * Returns false when the stock was short, and changes nothing in that case.
 */
export async function takeStock(client: PoolClient, productId: string, quantity: number): Promise<boolean> {
  const result = await client.query(
    'UPDATE products SET stock = stock - $2 WHERE id = $1 AND stock >= $2',
    [productId, quantity],
  );
  return result.rowCount === 1;
}

/** One product's current price and stock, read without a lock. */
export async function findProduct(runner: SqlRunner, id: string): Promise<Product | undefined> {
  const { rows } = await runner.query<Product>(
    `SELECT id, name, unit_price_cents AS "unitPriceCents", stock
       FROM products
      WHERE id = $1`,
    [id],
  );
  return rows[0];
}
