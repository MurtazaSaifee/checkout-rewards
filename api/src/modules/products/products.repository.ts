import type { Pool } from 'pg';

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
