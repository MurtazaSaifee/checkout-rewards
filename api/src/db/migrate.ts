import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';

/** Plain SQL files in api/migrations, applied in filename order. */
export const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

/**
 * Arbitrary key for the transaction-scoped advisory lock. Instances starting
 * at the same moment queue on it; the second one finds everything applied.
 */
const MIGRATION_LOCK_KEY = 724_001;

const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;

/**
 * Applies every migration not yet recorded in schema_migrations. The whole run
 * is one transaction, so a failing file leaves the schema exactly as it was,
 * and a second run is a no-op.
 */
export async function applyMigrations(pool: Pool, dir: URL = MIGRATIONS_DIR): Promise<string[]> {
  const dirPath = fileURLToPath(dir);
  const files = (await readdir(dirPath))
    .filter((name) => MIGRATION_FILE.test(name))
    .sort();

  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    text        PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query<{ version: string }>(
      'SELECT version FROM schema_migrations',
    );
    const done = new Set(rows.map((row) => row.version));

    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      if (done.has(version)) continue;

      const sql = await readFile(join(dirPath, file), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
      applied.push(version);
    }

    await client.query('COMMIT');
    return applied;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
