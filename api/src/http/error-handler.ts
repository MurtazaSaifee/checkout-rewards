import type { ErrorRequestHandler } from 'express';
import { toProblemDetails } from './problem-details.js';

/**
 * The single place where errors leave the service. Responds with Problem
 * Details and logs the failure under the request's own logger, so the line
 * carries the request identifier.
 */
export const problemErrorHandler: ErrorRequestHandler = (error: unknown, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const { status, body } = toProblemDetails(error, req.id);
  if (status >= 500) {
    req.log.error({ err: error, code: body.code }, 'request failed');
  } else {
    req.log.info({ code: body.code, status }, 'request rejected');
  }

  res
    .status(status)
    .type('application/problem+json')
    .json(body);
};
