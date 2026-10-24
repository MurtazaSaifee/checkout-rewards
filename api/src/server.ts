import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { bootstrapDatabase } from './db/bootstrap.js';
import { createPool } from './db/pool.js';
import { createLogger } from './logging.js';
import { FakePaymentGateway } from './modules/payments/fake-payment-gateway.js';

/**
 * Process entry point. Validates configuration, brings the database to the
 * expected state (migrations, then demo data), and only then accepts traffic.
 * Any failure before listening exits non-zero, so an orchestrator sees it.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel });
  const db = createPool(config.databaseUrl, logger);

  await bootstrapDatabase(db);
  logger.info('database schema and seed data are current');

  const app = createApp({
    db,
    logger,
    payments: new FakePaymentGateway(),
    adminKey: config.adminKey,
    coupons: config.coupons,
  });
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, 'api listening');
  });

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, 'shutting down');
    server.close(() => {
      void db.end().finally(() => process.exit(0));
    });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

main().catch((error: unknown) => {
  console.error('checkout-rewards-api failed to start:', error);
  process.exit(1);
});
