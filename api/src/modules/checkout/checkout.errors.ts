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

/**
 * The payment gateway declined the charge. Thrown inside the checkout
 * transaction, so the stock taken so far and the claimed key roll back with it.
 */
export class PaymentDeclinedError extends DomainError {
  constructor() {
    super({
      status: 402,
      code: 'PAYMENT_DECLINED',
      title: 'Payment declined',
      detail: 'The payment was declined. Nothing was placed, and the cart is still open.',
    });
  }
}
