import type { Pool } from 'pg';
import { applyMigrations } from './migrate.js';
import { seedProducts } from './seed.js';

/**
 * Brings a database to the state the service expects: schema first, then demo
 * data. Safe to run on every start, against an empty or an existing database.
 */
export async function bootstrapDatabase(pool: Pool): Promise<void> {
  await applyMigrations(pool);
  await seedProducts(pool);
}
