import { randomBytes } from 'node:crypto';
import type { Express } from 'express';
import { afterAll, beforeAll } from 'vitest';
import { Pool } from 'pg';
import { createApp } from '../../src/app.js';
import { DEFAULT_COUPON_RULES, type CouponRules } from '../../src/config.js';
import { bootstrapDatabase } from '../../src/db/bootstrap.js';
import { createLogger, type Logger } from '../../src/logging.js';

/**
 * Admin connection used to create and drop per-file databases. CI points this
 * at its Postgres service; locally, set TEST_DATABASE_URL to a server you own.
 */
const ADMIN_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';

/** The admin key every test app is started with. */
export const TEST_ADMIN_KEY = 'test-admin-key';

export interface TestDatabaseOptions {
  logger?: Logger;
  /** Overrides the coupon rules for this test file, for example n = 2 to reach milestones quickly. */
  coupons?: Partial<CouponRules>;
}

interface TestDatabaseState {
  app: Express;
  pool: Pool;
}

/**
 * Registers hooks for the calling test file. Each file gets its own uniquely
 * named database, migrated and seeded from scratch, and dropped afterwards.
 * Nothing depends on a fixed database name, so files can run in parallel.
 */
export function useTestDatabase(options: TestDatabaseOptions = {}): {
  readonly app: Express;
  readonly pool: Pool;
} {
  const state = {} as TestDatabaseState;
  let adminPool: Pool;
  let databaseName: string;

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL, max: 1 });
    databaseName = `checkout_test_${randomBytes(6).toString('hex')}`;
    await adminPool.query(`CREATE DATABASE "${databaseName}"`);

    const url = new URL(ADMIN_DATABASE_URL);
    url.pathname = `/${databaseName}`;
    state.pool = new Pool({ connectionString: url.toString(), max: 5 });

    await bootstrapDatabase(state.pool);
    state.app = createApp({
      db: state.pool,
      logger: options.logger ?? createLogger({ level: 'silent' }),
      adminKey: TEST_ADMIN_KEY,
      coupons: { ...DEFAULT_COUPON_RULES, ...options.coupons },
    });
  });

  afterAll(async () => {
    await state.pool.end();
    await adminPool.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await adminPool.end();
  });

  return {
    get app() {
      return state.app;
    },
    get pool() {
      return state.pool;
    },
  };
}
