import { DomainError, type ErrorCode } from '../errors.js';

/** Stable, dereference-free prefix for the RFC 9457 `type` member. */
const PROBLEM_TYPE_BASE = 'https://checkout-rewards.example/problems/';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: ErrorCode;
  requestId: string;
  [extension: string]: unknown;
}

export interface MappedProblem {
  status: number;
  body: ProblemDetails;
}

interface Described {
  status: number;
  code: ErrorCode;
  title: string;
  detail: string;
  extensions: Readonly<Record<string, unknown>>;
}

/** Titles for errors raised outside the domain (contract, parser, router). */
const GENERIC_TITLES: Record<ErrorCode, string> = {
  VALIDATION_FAILED: 'Request validation failed',
  MALFORMED_JSON: 'Malformed JSON',
  ROUTE_NOT_FOUND: 'Route not found',
  METHOD_NOT_ALLOWED: 'Method not allowed',
  PAYLOAD_TOO_LARGE: 'Payload too large',
  UNSUPPORTED_MEDIA_TYPE: 'Unsupported media type',
  INTERNAL_ERROR: 'Internal server error',
};

/** Maps an HTTP status raised by the contract validator or body parser to a code. */
const CODE_BY_STATUS: Partial<Record<number, ErrorCode>> = {
  400: 'VALIDATION_FAILED',
  404: 'ROUTE_NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
};

/**
 * Turns anything thrown while handling a request into an RFC 9457 document.
 * Typed domain errors keep their own status, code and title. Errors carrying an
 * HTTP status (the contract validator, the JSON parser) map through the table
 * above. Everything else is reported as an opaque internal error, so no stack
 * trace or internal message reaches the client.
 */
export function toProblemDetails(error: unknown, requestId: string): MappedProblem {
  const described = describe(error);
  const { status, code, title, detail, extensions } = described;
  return {
    status,
    body: {
      ...extensions,
      type: `${PROBLEM_TYPE_BASE}${code}`,
      title,
      status,
      detail,
      code,
      requestId,
    },
  };
}

function describe(error: unknown): Described {
  if (error instanceof DomainError) {
    return {
      status: error.status,
      code: error.code,
      title: error.title,
      detail: error.message,
      extensions: error.extensions,
    };
  }

  if (isHttpError(error) && error.status < 500) {
    if (error.type === 'entity.parse.failed') {
      return {
        status: 400,
        code: 'MALFORMED_JSON',
        title: GENERIC_TITLES.MALFORMED_JSON,
        detail: 'The request body is not valid JSON.',
        extensions: {},
      };
    }

    const code = CODE_BY_STATUS[error.status];
    if (code !== undefined) {
      return {
        status: error.status,
        code,
        title: GENERIC_TITLES[code],
        detail: error.message,
        extensions: error.errors ? { errors: error.errors.map(summariseFieldError) } : {},
      };
    }
  }

  return {
    status: 500,
    code: 'INTERNAL_ERROR',
    title: GENERIC_TITLES.INTERNAL_ERROR,
    detail: 'An unexpected error occurred.',
    extensions: {},
  };
}

interface HttpLikeError {
  status: number;
  message: string;
  type?: string;
  errors?: Array<{ path?: string; message?: string }>;
}

function isHttpError(error: unknown): error is HttpLikeError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number' &&
    error.status >= 400 &&
    error.status < 600 &&
    'message' in error &&
    typeof error.message === 'string'
  );
}

function summariseFieldError(item: { path?: string; message?: string }): {
  path: string | undefined;
  message: string | undefined;
} {
  return { path: item.path, message: item.message };
}
