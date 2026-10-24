import type { RequestHandler } from 'express';
import { DomainError } from '../errors.js';
import { GENERIC_TITLES } from './problem-details.js';

/**
 * Catches requests that no route or contract operation claimed, so that even an
 * unknown path answers with Problem Details instead of Express's HTML page.
 */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(
    new DomainError({
      status: 404,
      code: 'ROUTE_NOT_FOUND',
      title: GENERIC_TITLES.ROUTE_NOT_FOUND,
      detail: `No route matches ${req.method} ${req.path}.`,
    }),
  );
};
