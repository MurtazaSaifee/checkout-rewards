import { DomainError } from '../../errors.js';

/**
 * The cart does not exist, or it belongs to another customer. The two cases are
 * deliberately indistinguishable, so one customer cannot discover another's carts.
 */
export class CartNotFoundError extends DomainError {
  constructor() {
    super({
      status: 404,
      code: 'CART_NOT_FOUND',
      title: 'Cart not found',
      detail: 'No cart with this identifier belongs to the calling customer.',
    });
  }
}

export class CartAlreadyCheckedOutError extends DomainError {
  constructor() {
    super({
      status: 409,
      code: 'CART_ALREADY_CHECKED_OUT',
      title: 'Cart already checked out',
      detail: 'This cart has been checked out and can no longer be changed.',
    });
  }
}

/** A cart with no lines cannot be checked out: there is nothing to order. */
export class CartEmptyError extends DomainError {
  constructor() {
    super({
      status: 422,
      code: 'CART_EMPTY',
      title: 'Cart is empty',
      detail: 'The cart has no lines, so there is nothing to order.',
    });
  }
}

export class ProductNotFoundError extends DomainError {
  constructor(productId: string) {
    super({
      status: 404,
      code: 'PRODUCT_NOT_FOUND',
      title: 'Product not found',
      detail: `No product has the identifier ${JSON.stringify(productId)}.`,
    });
  }
}

export interface ShortLine {
  productId: string;
  requested: number;
  available: number;
}

/**
 * The requested quantity is more than the stock available. Stock is not held at
 * this point, so this is a courtesy check, and the same lines are checked again
 * at checkout. The extension lists each short line with its quantities.
 */
export class InsufficientStockError extends DomainError {
  constructor(shortLines: readonly ShortLine[]) {
    super({
      status: 409,
      code: 'INSUFFICIENT_STOCK',
      title: 'Insufficient stock',
      detail: 'The requested quantity is more than the stock available for a product.',
      extensions: { shortLines },
    });
  }
}
