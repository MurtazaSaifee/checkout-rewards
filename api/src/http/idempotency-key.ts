import type { Request, RequestHandler } from 'express';
import { DomainError } from '../errors.js';
import { NOT_BLANK, requiredHeader } from './required-header.js';

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

export class IdempotencyKeyRequiredError extends DomainError {
  constructor() {
    super({
      status: 400,
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      title: 'Idempotency key required',
      detail: `The ${IDEMPOTENCY_KEY_HEADER} header identifies this checkout attempt and must not be empty.`,
    });
  }
}

const idempotencyKeyHeader = requiredHeader({
  name: IDEMPOTENCY_KEY_HEADER,
  pattern: NOT_BLANK,
  missing: () => new IdempotencyKeyRequiredError(),
});

/**
 * Takes the idempotency key from the header and records it on the request. Mounted
 * ahead of the contract validator, so a missing key is answered with
 * IDEMPOTENCY_KEY_REQUIRED rather than the validator's generic code. A key with
 * characters outside the contract's pattern is left to the validator.
 */
export function requireIdempotencyKey(): RequestHandler {
  return idempotencyKeyHeader.guard();
}

/** The attempt's idempotency key, for handlers behind requireIdempotencyKey. */
export function idempotencyKeyOf(req: Request): string {
  return idempotencyKeyHeader.valueOf(req);
}
