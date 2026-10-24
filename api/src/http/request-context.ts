import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { Logger } from '../logging.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Identifier for this exchange; echoed in responses and error bodies. */
      id: string;
      /** Logger that stamps every line with `id`. */
      log: Logger;
    }
  }
}

export const REQUEST_ID_HEADER = 'X-Request-Id';

/** Client identifiers are echoed only if they are short and token-like. */
const SAFE_CLIENT_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Keeps the client's identifier when it is safe to echo into logs and headers,
 * and generates one otherwise.
 */
function resolveRequestId(clientValue: string | undefined): string {
  if (clientValue !== undefined && SAFE_CLIENT_REQUEST_ID.test(clientValue)) {
    return clientValue;
  }
  return randomUUID();
}

/**
 * Gives every request its identifier, echoes it in the response header, and
 * provides a logger that stamps it on each line. Writes one access line when
 * the response finishes.
 */
export function requestContext(logger: Logger): RequestHandler {
  return (req, res, next) => {
    req.id = resolveRequestId(req.get(REQUEST_ID_HEADER));
    req.log = logger.child({ requestId: req.id });
    res.setHeader(REQUEST_ID_HEADER, req.id);

    const startedAt = performance.now();
    res.once('finish', () => {
      req.log.info(
        {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Math.round(performance.now() - startedAt),
        },
        'request completed',
      );
    });

    next();
  };
}
