import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  it('uses local defaults when the environment is empty', () => {
    expect(loadConfig({})).toEqual({
      port: 3000,
      databaseUrl: 'postgres://postgres:postgres@localhost:5432/checkout_rewards',
      logLevel: 'info',
    });
  });

  it('reads the port, database URL and log level from the environment', () => {
    expect(
      loadConfig({
        PORT: '8081',
        DATABASE_URL: 'postgres://app@db.internal:5432/rewards',
        LOG_LEVEL: 'debug',
      }),
    ).toEqual({
      port: 8081,
      databaseUrl: 'postgres://app@db.internal:5432/rewards',
      logLevel: 'debug',
    });
  });

  it.each([
    ['PORT', 'abc'],
    ['PORT', '3000.5'],
    ['PORT', '0'],
    ['PORT', '70000'],
    ['LOG_LEVEL', 'verbose'],
    ['DATABASE_URL', ''],
  ])('refuses to start when %s is %j', (name, value) => {
    expect(() => loadConfig({ [name]: value })).toThrow(ConfigError);
    expect(() => loadConfig({ [name]: value })).toThrow(name);
  });
});
