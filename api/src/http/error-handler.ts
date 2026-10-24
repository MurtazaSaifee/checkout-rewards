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

  res
    .status(status)
    .type('application/problem+json')
    .json(body);
};
