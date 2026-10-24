import type { ErrorRequestHandler } from 'express';
import { toProblemDetails } from './problem-details.js';

/**
 * The single place where errors leave the service. Responds with Problem
 * Details and logs the failure under the request's own logger, so the line
 * carries the request identifier. A refusal that its route has already logged
 * as the request's outcome, with its code, is not logged a second time.
 */
export const problemErrorHandler: ErrorRequestHandler = (error: unknown, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const { status, body } = toProblemDetails(error, req.id);
  if (status >= 500) {
    req.log.error({ err: error, code: body.code }, 'request failed');
  } else if (res.locals.outcomeLogged !== true) {
    req.log.info({ code: body.code, status }, 'request rejected');
  }

  const allow = status === 405 ? allowedMethodsOf(error) : undefined;
  if (allow !== undefined) {
    res.set('Allow', allow);
  }
  res
    .status(status)
    .type('application/problem+json')
    .json(body);
};

/**
 * The methods the contract documents for the path, from the validator's 405.
 * The validator lists them in lower case; HTTP method names are upper case.
 */
function allowedMethodsOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('headers' in error)) return undefined;
  const { headers } = error;
  if (typeof headers !== 'object' || headers === null || !('Allow' in headers)) return undefined;
  const allow = headers.Allow;
  if (typeof allow !== 'string') return undefined;
  return allow
    .split(',')
    .map((method) => method.trim().toUpperCase())
    .join(', ');
}
