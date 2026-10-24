import type { Request, RequestHandler } from 'express';
import type { DomainError } from '../errors.js';

/** A value with at least one character that is not whitespace. */
export const NOT_BLANK = /\S/;

export interface RequiredHeaderOptions {
  /** The header's name as it appears on the wire. */
  name: string;
  /** A present header must match this pattern, or the request is refused. */
  pattern: RegExp;
  /** Makes the domain error that refuses a request without a usable header. */
  missing: () => DomainError;
}

export interface RequiredHeader {
  /** Middleware that refuses a request without a usable header, and records the value otherwise. */
  guard(): RequestHandler;
  /** The recorded value, for a handler behind the guard. */
  valueOf(req: Request): string;
}

/**
 * A header that every route in a group must carry. The guard is mounted ahead of
 * the contract validator, so a missing header is answered with the factory's own
 * domain error rather than the validator's generic code. Values are kept per
 * request in a WeakMap, so the request object itself is not extended.
 */
export function requiredHeader({ name, pattern, missing }: RequiredHeaderOptions): RequiredHeader {
  const values = new WeakMap<Request, string>();

  return {
    guard() {
      return (req, _res, next) => {
        const value = req.get(name);
        if (value === undefined || !pattern.test(value)) {
          next(missing());
          return;
        }
        values.set(req, value);
        next();
      };
    },
    valueOf(req) {
      const value = values.get(req);
      if (value === undefined) {
        throw new Error(`${name} was read on a route that is not behind its guard`);
      }
      return value;
    },
  };
}
