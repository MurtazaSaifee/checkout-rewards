import type { Request, RequestHandler } from 'express';
import { DomainError } from '../errors.js';

export const CUSTOMER_ID_HEADER = 'X-Customer-Id';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** The calling customer. Set only on routes behind requireCustomerIdentity. */
      customerId?: string;
    }
  }
}

export class CustomerIdRequiredError extends DomainError {
  constructor() {
    super({
      status: 400,
      code: 'CUSTOMER_ID_REQUIRED',
      title: 'Customer identifier required',
      detail: `The ${CUSTOMER_ID_HEADER} header identifies the calling customer and must not be empty.`,
    });
  }
}

/**
 * Takes the customer identifier from the header and records it on the request.
 * The identifier is claimed, not verified: it is a business rule, and real
 * authentication would replace this function without touching the routes.
 *
 * Mounted ahead of the contract validator, so a missing header is answered with
 * CUSTOMER_ID_REQUIRED rather than the validator's generic code.
 */
export function requireCustomerIdentity(): RequestHandler {
  return (req, _res, next) => {
    const value = req.get(CUSTOMER_ID_HEADER);
    if (value === undefined || value.trim() === '') {
      next(new CustomerIdRequiredError());
      return;
    }
    req.customerId = value;
    next();
  };
}

/** The calling customer's identifier, for handlers behind requireCustomerIdentity. */
export function customerIdOf(req: Request): string {
  if (req.customerId === undefined) {
    throw new Error('customerIdOf was called on a route that is not behind requireCustomerIdentity');
  }
  return req.customerId;
}
