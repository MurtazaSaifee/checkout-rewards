export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface Config {
  port: number;
  databaseUrl: string;
  logLevel: LogLevel;
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

/**
 * Reads and validates settings once, at startup. Values are fixed for the life
 * of the process. Pure: it takes the environment as an argument.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    port: parsePort(env.PORT ?? '3000'),
    databaseUrl: parseDatabaseUrl(env.DATABASE_URL ?? DEFAULT_DATABASE_URL),
    logLevel: parseLogLevel(env.LOG_LEVEL ?? 'info'),
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
