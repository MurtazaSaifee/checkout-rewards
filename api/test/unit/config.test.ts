import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  it('uses local defaults when the environment is empty', () => {
    expect(loadConfig({})).toEqual({
      port: 3000,
      databaseUrl: 'postgres://postgres:postgres@localhost:5432/checkout_rewards',
      logLevel: 'info',
      adminKey: 'local-admin-key',
      coupons: { everyNOrders: 5, percentOff: 10 },
    });
  });

  it('reads the port, database URL and log level from the environment', () => {
    expect(
      loadConfig({
        PORT: '8081',
        DATABASE_URL: 'postgres://app@db.internal:5432/rewards',
        LOG_LEVEL: 'debug',
      }),
    ).toMatchObject({
      port: 8081,
      databaseUrl: 'postgres://app@db.internal:5432/rewards',
      logLevel: 'debug',
    });
  });

  it('reads the admin key and the coupon rules, and trims the admin key', () => {
    expect(
      loadConfig({
        ADMIN_KEY: '  s3cret-key  ',
        COUPON_EVERY_N_ORDERS: '3',
        COUPON_PERCENT_OFF: '100',
      }),
    ).toMatchObject({
      adminKey: 's3cret-key',
      coupons: { everyNOrders: 3, percentOff: 100 },
    });
  });

  it('accepts the smallest milestone frequency and the smallest percentage', () => {
    expect(loadConfig({ COUPON_EVERY_N_ORDERS: '1', COUPON_PERCENT_OFF: '1' }).coupons).toEqual({
      everyNOrders: 1,
      percentOff: 1,
    });
  });

  it.each([
    ['PORT', 'abc'],
    ['PORT', '3000.5'],
    ['PORT', '0'],
    ['PORT', '70000'],
    ['LOG_LEVEL', 'verbose'],
    ['DATABASE_URL', ''],
    ['ADMIN_KEY', ''],
    ['ADMIN_KEY', '   '],
    ['COUPON_EVERY_N_ORDERS', '0'],
    ['COUPON_EVERY_N_ORDERS', '-1'],
    ['COUPON_EVERY_N_ORDERS', '2.5'],
    ['COUPON_EVERY_N_ORDERS', 'five'],
    ['COUPON_EVERY_N_ORDERS', ''],
    ['COUPON_PERCENT_OFF', '0'],
    ['COUPON_PERCENT_OFF', '101'],
    ['COUPON_PERCENT_OFF', '10%'],
    ['COUPON_PERCENT_OFF', ''],
  ])('refuses to start when %s is %j', (name, value) => {
    expect(() => loadConfig({ [name]: value })).toThrow(ConfigError);
    expect(() => loadConfig({ [name]: value })).toThrow(name);
  });
});
