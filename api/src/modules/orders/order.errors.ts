import { DomainError } from '../../errors.js';

/**
 * The order does not exist, or it belongs to another customer. The two cases are
 * deliberately indistinguishable, so one customer cannot discover another's orders.
 */
export class OrderNotFoundError extends DomainError {
  constructor() {
    super({
      status: 404,
      code: 'ORDER_NOT_FOUND',
      title: 'Order not found',
      detail: 'No order with this identifier belongs to the calling customer.',
    });
  }
}
