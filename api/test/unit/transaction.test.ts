import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { withTransaction } from '../../src/db/transaction.js';

/**
 * A pool whose single connection records every statement and every release.
 * A statement listed in `failOn` rejects with its error. The unit tests use
 * this because the failure paths (a ROLLBACK that itself fails) cannot be
 * forced through a real connection without killing it.
 */
function fakePool(failOn: Record<string, Error> = {}) {
  const statements: string[] = [];
  const releases: unknown[] = [];
  const client = {
    query: (sql: string) => {
      statements.push(sql);
      const failure = failOn[sql];
      return failure !== undefined ? Promise.reject(failure) : Promise.resolve({ rows: [] });
    },
    release: (error?: unknown) => {
      releases.push(error);
    },
  };
  const pool = { connect: () => Promise.resolve(client) } as unknown as Pool;
  return { pool, statements, releases };
}

describe('withTransaction', () => {
  it('commits and returns the work result on a clean run', async () => {
    const { pool, statements, releases } = fakePool();

    const result = await withTransaction(pool, () => Promise.resolve('done'));

    expect(result).toBe('done');
    expect(statements).toEqual(['BEGIN', 'COMMIT']);
    expect(releases).toEqual([undefined]);
  });

  it('rolls back and rethrows the work error, releasing the healthy client', async () => {
    const workError = new Error('constraint failed');
    const { pool, statements, releases } = fakePool();

    await expect(withTransaction(pool, () => Promise.reject(workError))).rejects.toBe(workError);

    expect(statements).toEqual(['BEGIN', 'ROLLBACK']);
    expect(releases).toEqual([undefined]);
  });

  it('still rethrows the original error when ROLLBACK itself fails', async () => {
    const workError = new Error('constraint failed');
    const rollbackError = new Error('connection lost');
    const { pool, releases } = fakePool({ ROLLBACK: rollbackError });

    await expect(withTransaction(pool, () => Promise.reject(workError))).rejects.toBe(workError);

    // The connection state is unknown after a failed ROLLBACK, so the pool must discard it.
    expect(releases).toEqual([rollbackError]);
  });
});
