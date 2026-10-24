import type { Pool, PoolClient } from 'pg';

/** Anything that can run a statement: the pool for reads, or a client inside a transaction. */
export type SqlRunner = Pick<Pool, 'query'>;

/**
 * Runs work in one transaction on one connection. Commits when the work
 * resolves; rolls back and rethrows when it rejects, so a failed operation
 * leaves nothing partly applied.
 */
export async function withTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
