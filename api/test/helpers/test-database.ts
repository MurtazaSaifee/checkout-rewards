import { randomBytes } from 'node:crypto';
import type { Express } from 'express';
import { afterAll, beforeAll } from 'vitest';
import { Pool } from 'pg';
import { createApp } from '../../src/app.js';
import { DEFAULT_COUPON_RULES, type CouponRules } from '../../src/config.js';
import { bootstrapDatabase } from '../../src/db/bootstrap.js';
import { createLogger, type Logger } from '../../src/logging.js';
import { FakePaymentGateway } from '../../src/modules/payments/fake-payment-gateway.js';
import type { PaymentGateway } from '../../src/modules/payments/payment-gateway.js';

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
  /** Replaces the fake payment gateway, for a test that needs to see what is charged. */
  payments?: PaymentGateway;
}

interface TestDatabaseState {
  app: Express;
  pool: Pool;
  url: string;
}

/**
 * Registers hooks for the calling test file. Each file gets its own uniquely
 * named database, migrated and seeded from scratch, and dropped afterwards.
 * Nothing depends on a fixed database name, so files can run in parallel.
 */
export function useTestDatabase(options: TestDatabaseOptions = {}): {
  readonly app: Express;
  readonly pool: Pool;
  /** Connection URL of this file's database, for a test that opens its own pool. */
  readonly url: string;
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
    state.url = url.toString();
    // Enough connections for ten simultaneous requests to run at once, as the concurrency cases need.
    state.pool = new Pool({ connectionString: state.url, max: 12 });

    await bootstrapDatabase(state.pool);
    state.app = createApp({
      db: state.pool,
      logger: options.logger ?? createLogger({ level: 'silent' }),
      payments: options.payments ?? new FakePaymentGateway(),
      adminKey: TEST_ADMIN_KEY,
      coupons: { ...DEFAULT_COUPON_RULES, ...options.coupons },
    });
  });

  afterAll(async () => {
    // Dropping the database with FORCE closes any connection still open, and an idle pooled
    // client can report that closure after end() has resolved. The closure is expected here.
    state.pool.on('error', () => undefined);
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
    get url() {
      return state.url;
    },
  };
}
