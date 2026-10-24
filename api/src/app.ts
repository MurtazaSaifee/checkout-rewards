import express, { type Express } from 'express';
import type { Pool } from 'pg';
import { contractValidator } from './http/contract.js';
import { problemErrorHandler } from './http/error-handler.js';
import { notFoundHandler } from './http/not-found.js';
import { requestContext } from './http/request-context.js';
import type { Logger } from './logging.js';
import { productsRouter } from './modules/products/products.routes.js';

export interface AppDependencies {
  db: Pool;
  logger: Logger;
}

/** Builds the HTTP application. Tests and the server both enter here. */
export function createApp(deps: AppDependencies): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(requestContext(deps.logger));
  app.use(express.json());
  app.use(contractValidator());

  app.use('/api', productsRouter(deps.db));

  app.use(notFoundHandler);
  app.use(problemErrorHandler);
  return app;
}
