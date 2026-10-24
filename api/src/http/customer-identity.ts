import type { Request, RequestHandler } from 'express';
import { DomainError } from '../errors.js';
import { NOT_BLANK, requiredHeader } from './required-header.js';

export const CUSTOMER_ID_HEADER = 'X-Customer-Id';

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

const customerIdHeader = requiredHeader({
  name: CUSTOMER_ID_HEADER,
  pattern: NOT_BLANK,
  missing: () => new CustomerIdRequiredError(),
});

/**
 * Takes the customer identifier from the header and records it on the request.
 * The identifier is claimed, not verified: it is a business rule, and real
 * authentication would replace this function without touching the routes.
 *
 * Mounted ahead of the contract validator, so a missing header is answered with
 * CUSTOMER_ID_REQUIRED rather than the validator's generic code.
 */
export function requireCustomerIdentity(): RequestHandler {
  return customerIdHeader.guard();
}

/** The calling customer's identifier, for handlers behind requireCustomerIdentity. */
export function customerIdOf(req: Request): string {
  return customerIdHeader.valueOf(req);
}
