import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { DomainError } from '../errors.js';

export const ADMIN_KEY_HEADER = 'X-Admin-Key';

export class AdminKeyInvalidError extends DomainError {
  constructor() {
    super({
      status: 401,
      code: 'ADMIN_KEY_INVALID',
      title: 'Admin key invalid',
      detail: `The ${ADMIN_KEY_HEADER} header must carry the admin key, and it is missing or wrong.`,
    });
  }
}

/**
 * Admits a request only when its admin key header equals the configured key.
 * The key is a placeholder shared by the store's operators, not a security
 * control: real authentication would replace this function without touching
 * the routes. Comparison is constant time, so the key cannot be probed by timing.
 *
 * Mounted ahead of the contract validator, so a missing or wrong key is answered
 * with ADMIN_KEY_INVALID rather than the validator's generic code.
 */
export function requireAdminKey(expectedKey: string): RequestHandler {
  const expected = digest(expectedKey);
  return (req, _res, next) => {
    const provided = req.get(ADMIN_KEY_HEADER);
    if (provided === undefined || !timingSafeEqual(digest(provided), expected)) {
      next(new AdminKeyInvalidError());
      return;
    }
    next();
  };
}

/** Equal-length digests make the comparison constant time whatever the lengths of the keys. */
function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
