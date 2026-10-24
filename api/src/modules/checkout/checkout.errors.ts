import { DomainError } from '../../errors.js';

/**
 * The key was already used for a different checkout request. The first request
 * is the one that counts, so a client that reuses a key for another checkout has
 * a bug, and the second request is refused rather than treated as a retry.
 */
export class IdempotencyKeyReusedError extends DomainError {
  constructor() {
    super({
      status: 422,
      code: 'IDEMPOTENCY_KEY_REUSED',
      title: 'Idempotency key reused',
      detail: 'This idempotency key was already used for a different checkout request.',
    });
  }
}
