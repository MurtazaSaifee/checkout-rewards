import type { Pool } from 'pg';

interface SeedProduct {
  id: string;
  name: string;
  unitPriceCents: number;
  stock: number;
}

/**
 * Demo catalogue. Ids are stable slugs so the README and examples can refer to
 * them. Only "limited-hoodie" starts with scarce stock, for race demonstrations.
 */
export const SEED_PRODUCTS: readonly SeedProduct[] = [
  { id: 'classic-tee', name: 'Classic Cotton Tee', unitPriceCents: 2500, stock: 40 },
  { id: 'ceramic-mug', name: 'Ceramic Mug', unitPriceCents: 1200, stock: 60 },
  { id: 'canvas-tote', name: 'Canvas Tote Bag', unitPriceCents: 1800, stock: 25 },
  { id: 'enamel-bottle', name: 'Enamel Water Bottle', unitPriceCents: 1650, stock: 30 },
  { id: 'notebook-set', name: 'Notebook Set', unitPriceCents: 950, stock: 80 },
  { id: 'limited-hoodie', name: 'Limited Edition Hoodie', unitPriceCents: 8999, stock: 3 },
];

/**
 * Inserts the demo products that are not already present. ON CONFLICT leaves
 * existing rows untouched, so reseeding never duplicates a product and never
 * resets stock that has since changed.
 */
export async function seedProducts(pool: Pool): Promise<void> {
  await pool.query(
    `INSERT INTO products (id, name, unit_price_cents, stock)
     SELECT * FROM unnest($1::text[], $2::text[], $3::integer[], $4::integer[])
     ON CONFLICT (id) DO NOTHING`,
    [
      SEED_PRODUCTS.map((p) => p.id),
      SEED_PRODUCTS.map((p) => p.name),
      SEED_PRODUCTS.map((p) => p.unitPriceCents),
      SEED_PRODUCTS.map((p) => p.stock),
    ],
  );
}
