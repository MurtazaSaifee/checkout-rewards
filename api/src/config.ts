export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** The coupon rules, fixed for the life of the process. */
export interface CouponRules {
  /** Milestone frequency n: every nth placed order reaches a milestone. */
  everyNOrders: number;
  /** Whole-number percentage that every coupon takes off its order's subtotal. */
  percentOff: number;
}

export interface Config {
  port: number;
  databaseUrl: string;
  logLevel: LogLevel;
  adminKey: string;
  coupons: CouponRules;
}

/** Raised at startup when a setting is missing or malformed. The service then refuses to start. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Local development default. Compose and CI set DATABASE_URL explicitly. */
const DEFAULT_DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/checkout_rewards';

/** A public placeholder. The admin key is a business rule, not a security control. */
export const DEFAULT_ADMIN_KEY = 'local-admin-key';

export const DEFAULT_COUPON_RULES: CouponRules = { everyNOrders: 5, percentOff: 10 };

/** The largest value an integer column in the schema can hold. */
const MAX_INT32 = 2_147_483_647;

/**
 * Reads and validates settings once, at startup. Values are fixed for the life
 * of the process. Pure: it takes the environment as an argument.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    port: parsePort(env.PORT ?? '3000'),
    databaseUrl: parseDatabaseUrl(env.DATABASE_URL ?? DEFAULT_DATABASE_URL),
    logLevel: parseLogLevel(env.LOG_LEVEL ?? 'info'),
    adminKey: parseAdminKey(env.ADMIN_KEY ?? DEFAULT_ADMIN_KEY),
    coupons: {
      everyNOrders: parseWholeNumber(
        'COUPON_EVERY_N_ORDERS',
        env.COUPON_EVERY_N_ORDERS ?? String(DEFAULT_COUPON_RULES.everyNOrders),
        1,
        MAX_INT32,
      ),
      percentOff: parseWholeNumber(
        'COUPON_PERCENT_OFF',
        env.COUPON_PERCENT_OFF ?? String(DEFAULT_COUPON_RULES.percentOff),
        1,
        100,
      ),
    },
  };
}

function parsePort(raw: string): number {
  const port = Number(raw);
  if (!/^\d+$/.test(raw) || port < 1 || port > 65_535) {
    throw new ConfigError(`PORT must be a whole number from 1 to 65535, got ${JSON.stringify(raw)}`);
  }
  return port;
}

function parseDatabaseUrl(raw: string): string {
  if (raw.trim() === '') {
    throw new ConfigError('DATABASE_URL must not be empty');
  }
  return raw;
}

function parseLogLevel(raw: string): LogLevel {
  if ((LOG_LEVELS as readonly string[]).includes(raw)) {
    return raw as LogLevel;
  }
  throw new ConfigError(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}, got ${JSON.stringify(raw)}`);
}

function parseAdminKey(raw: string): string {
  const key = raw.trim();
  if (key === '') {
    throw new ConfigError('ADMIN_KEY must not be empty');
  }
  return key;
}

function parseWholeNumber(name: string, raw: string, min: number, max: number): number {
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || value < min || value > max) {
    throw new ConfigError(`${name} must be a whole number from ${min} to ${max}, got ${JSON.stringify(raw)}`);
  }
  return value;
}
