import { DomainError } from '../../errors.js';

/**
 * No milestone is waiting for a coupon: either no milestone has been reached, or
 * every reached milestone already has its coupon. Trying again later can succeed,
 * once another milestone is reached.
 */
export class NoEligibleMilestoneError extends DomainError {
  constructor() {
    super({
      status: 409,
      code: 'NO_ELIGIBLE_MILESTONE',
      title: 'No eligible milestone',
      detail: 'No milestone is waiting for a coupon. Every reached milestone already has one.',
    });
  }
}

/**
 * No coupon has this code. A mistyped code is reported this way, so it can be told
 * apart from a coupon that exists but cannot be used.
 */
export class CouponNotFoundError extends DomainError {
  constructor() {
    super({
      status: 422,
      code: 'COUPON_NOT_FOUND',
      title: 'Coupon not found',
      detail: 'No coupon has this code.',
    });
  }
}

/** The coupon was issued to another customer, so the calling customer cannot redeem it. */
export class CouponNotOwnedError extends DomainError {
  constructor() {
    super({
      status: 422,
      code: 'COUPON_NOT_OWNED',
      title: 'Coupon not owned',
      detail: 'This coupon was issued to another customer.',
    });
  }
}

/** An order has already redeemed the coupon. A coupon is redeemed once and then stays redeemed. */
export class CouponAlreadyRedeemedError extends DomainError {
  constructor() {
    super({
      status: 422,
      code: 'COUPON_ALREADY_REDEEMED',
      title: 'Coupon already redeemed',
      detail: 'This coupon has already been redeemed by an order.',
    });
  }
}
