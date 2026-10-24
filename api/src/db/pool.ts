import { Pool } from 'pg';
import type { Logger } from '../logging.js';

/**
 * Creates the application's connection pool. A client sitting idle in the pool
 * can lose its connection; the pool then emits 'error', and with no listener
 * Node would crash the process. The error is logged instead, and the pool
 * replaces the lost client the next time one is needed.
 */
export function createPool(connectionString: string, logger: Logger): Pool {
  const pool = new Pool({ connectionString });
  pool.on('error', (error) => {
    logger.error({ err: error }, 'idle database connection failed');
  });
  return pool;
}
