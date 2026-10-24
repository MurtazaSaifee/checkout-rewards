import type { Pool, PoolClient } from 'pg';

/** Anything that can run a statement: the pool for reads, or a client inside a transaction. */
export type SqlRunner = Pick<Pool, 'query'>;

/**
 * The statement that opens a read-only snapshot. Every query in the transaction
 * sees the state committed when the first query ran, and the transaction takes
 * no row locks, so reads of this kind never wait on or block a checkout.
 */
export const READ_ONLY_SNAPSHOT = 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY';

/**
 * Runs work in one transaction on one connection. Commits when the work
 * resolves; rolls back and rethrows when it rejects, so a failed operation
 * leaves nothing partly applied. The begin statement defaults to a plain BEGIN,
 * and a read may pass READ_ONLY_SNAPSHOT instead.
 */
export async function withTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
  begin = 'BEGIN',
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(begin);
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
