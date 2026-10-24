import express, { type Express } from 'express';
import type { Pool } from 'pg';
import type { CouponRules } from './config.js';
import { contractValidator } from './http/contract.js';
import { requireAdminKey } from './http/admin-key.js';
import { requireCustomerIdentity } from './http/customer-identity.js';
import { problemErrorHandler } from './http/error-handler.js';
import { requireIdempotencyKey } from './http/idempotency-key.js';
import { notFoundHandler } from './http/not-found.js';
import { requestContext } from './http/request-context.js';
import type { Logger } from './logging.js';
import { cartsRouter } from './modules/carts/carts.routes.js';
import { checkoutRouter } from './modules/checkout/checkout.routes.js';
import { couponsRouter } from './modules/coupons/coupons.routes.js';
import { ordersRouter } from './modules/orders/orders.routes.js';
import { type PaymentGateway } from './modules/payments/payment-gateway.js';
import { productsRouter } from './modules/products/products.routes.js';
import { reportingRouter } from './modules/reporting/reporting.routes.js';

export interface AppDependencies {
  db: Pool;
  logger: Logger;
  payments: PaymentGateway;
  /** The key every admin operation requires in the admin key header. */
  adminKey: string;
  /** Milestone frequency and percentage, fixed for the life of the process. */
  coupons: CouponRules;
}

/** Builds the HTTP application. Tests and the server both enter here. */
export function createApp(deps: AppDependencies): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(requestContext(deps.logger));
  app.use(express.json());
  // Ahead of the contract validator, so a missing customer header gets its own code.
  app.use('/api/carts', requireCustomerIdentity());
  app.use('/api/orders', requireCustomerIdentity());
  app.use('/api/coupons', requireCustomerIdentity());
  // The same for admin operations: a missing or wrong key gets ADMIN_KEY_INVALID.
  app.use('/api/admin', requireAdminKey(deps.adminKey));
  // Checkout requires the key, and this runs ahead of the validator for the same reason.
  app.post('/api/carts/:cartId/checkout', requireIdempotencyKey());
  app.use(contractValidator());

  app.use('/api', productsRouter(deps.db));
  app.use('/api', cartsRouter(deps.db));
  app.use('/api', checkoutRouter(deps.db, deps.payments));
  app.use('/api', ordersRouter(deps.db));
  app.use('/api', couponsRouter(deps.db, deps.coupons));
  app.use('/api', reportingRouter(deps.db, deps.coupons));

  app.use(notFoundHandler);
  app.use(problemErrorHandler);
  return app;
}
