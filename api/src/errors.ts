/** Codes raised outside the domain: by the contract validator, the body parser, the router and the fallback. */
export type HttpErrorCode =
  | 'VALIDATION_FAILED'
  | 'MALFORMED_JSON'
  | 'ROUTE_NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'INTERNAL_ERROR';

/** Codes raised by domain modules. */
export type DomainErrorCode =
  | 'CUSTOMER_ID_REQUIRED'
  | 'CART_NOT_FOUND'
  | 'CART_ALREADY_CHECKED_OUT'
  | 'PRODUCT_NOT_FOUND'
  | 'INSUFFICIENT_STOCK'
  | 'CART_EMPTY'
  | 'ORDER_NOT_FOUND'
  | 'ADMIN_KEY_INVALID'
  | 'NO_ELIGIBLE_MILESTONE'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'PAYMENT_DECLINED'
  | 'PRICE_CHANGED';

/**
 * Every stable error code a client can receive. The ErrorCode enum in
 * api/openapi.yaml must list the same values.
 */
export type ErrorCode = HttpErrorCode | DomainErrorCode;

export interface DomainErrorInit {
  status: number;
  code: ErrorCode;
  title: string;
  detail: string;
  extensions?: Record<string, unknown>;
}

/**
 * A failure with a stable code that a client can act on. Domain modules throw
 * subclasses that fix status, code and title; the HTTP layer maps them to
 * Problem Details. The extensions carry code-specific fields.
 */
export class DomainError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly title: string;
  readonly extensions: Readonly<Record<string, unknown>>;

  constructor(init: DomainErrorInit) {
    super(init.detail);
    this.name = new.target.name;
    this.status = init.status;
    this.code = init.code;
    this.title = init.title;
    this.extensions = init.extensions ?? {};
  }
}
