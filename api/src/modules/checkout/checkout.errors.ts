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
 * The total at current prices is not the total the customer was shown. Thrown
 * before the charge, inside the checkout transaction, so nothing is placed and
 * the stock taken so far rolls back with it. The current total is returned so
 * the customer can review it and check out again.
 */
export class PriceChangedError extends DomainError {
  constructor(currentTotalCents: number) {
    super({
      status: 409,
      code: 'PRICE_CHANGED',
      title: 'Price changed',
      detail: 'The total at current prices differs from the expected total, so nothing was placed.',
      extensions: { currentTotalCents },
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
