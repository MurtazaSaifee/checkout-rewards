import type { Pool } from 'pg';
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
