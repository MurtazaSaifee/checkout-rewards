/**
 * Every stable error code a client can receive. The ErrorCode enum in
 * api/openapi.yaml must list the same values.
 */
export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'MALFORMED_JSON'
  | 'ROUTE_NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'INTERNAL_ERROR';

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
