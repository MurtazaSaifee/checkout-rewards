import pino, { type DestinationStream, type Logger } from 'pino';

export type { Logger } from 'pino';

export interface LoggerOptions {
  level: string;
  destination?: DestinationStream;
}

/** Structured JSON logger. Request-scoped lines get a child with requestId. */
export function createLogger({ level, destination }: LoggerOptions): Logger {
  return pino({ level, base: { service: 'checkout-rewards-api' } }, destination);
}
