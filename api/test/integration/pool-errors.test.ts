import { randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createPool } from '../../src/db/pool.js';
import { createLogger } from '../../src/logging.js';
import { useTestDatabase } from '../helpers/test-database.js';

describe('connection pool', () => {
  const database = useTestDatabase();

  it('logs a lost idle connection and keeps serving queries', async () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const logger = createLogger({ level: 'error', destination: sink });

    // A private application name lets the test end only this pool's connections.
    const applicationName = `pool-test-${randomBytes(4).toString('hex')}`;
    const url = new URL(database.url);
    url.searchParams.set('application_name', applicationName);
    const pool = createPool(url.toString(), logger);

    try {
      await pool.query('SELECT 1'); // leaves one idle connection in the pool
      await database.pool.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = $1',
        [applicationName],
      );

      await vi.waitFor(() => {
        expect(lines.join('')).toContain('idle database connection failed');
      });
      await expect(pool.query('SELECT 1 AS one')).resolves.toMatchObject({ rows: [{ one: 1 }] });
    } finally {
      await pool.end();
    }
  });
});
