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
