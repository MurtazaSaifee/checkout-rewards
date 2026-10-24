import type { Request, RequestHandler } from 'express';
import { DomainError } from '../errors.js';

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** The checkout attempt's idempotency key. Set only on routes behind requireIdempotencyKey. */
      idempotencyKey?: string;
    }
  }
}

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

/**
 * Takes the idempotency key from the header and records it on the request. Mounted
 * ahead of the contract validator, so a missing key is answered with
 * IDEMPOTENCY_KEY_REQUIRED rather than the validator's generic code. A key with
 * characters outside the contract's pattern is left to the validator.
 */
export function requireIdempotencyKey(): RequestHandler {
  return (req, _res, next) => {
    const value = req.get(IDEMPOTENCY_KEY_HEADER);
    if (value === undefined || value.trim() === '') {
      next(new IdempotencyKeyRequiredError());
      return;
    }
    req.idempotencyKey = value;
    next();
  };
}

/** The attempt's idempotency key, for handlers behind requireIdempotencyKey. */
export function idempotencyKeyOf(req: Request): string {
  if (req.idempotencyKey === undefined) {
    throw new Error('idempotencyKeyOf was called on a route that is not behind requireIdempotencyKey');
  }
  return req.idempotencyKey;
}
