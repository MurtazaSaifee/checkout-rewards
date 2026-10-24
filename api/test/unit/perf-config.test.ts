import { describe, expect, it } from 'vitest';
import { readLoadConfig } from '../../perf/config.js';

describe('readLoadConfig', () => {
  it('uses the local API, the public admin key and the default sizes when nothing is set', () => {
    expect(readLoadConfig({})).toEqual({
      baseUrl: 'http://localhost:3000/api',
      adminKey: 'local-admin-key',
      connections: 20,
      spreadCheckouts: undefined,
      contendedCheckouts: 100,
    });
  });

  it('reads the settings it is given, dropping a trailing slash from the base URL', () => {
    expect(
      readLoadConfig({
        BASE_URL: 'http://127.0.0.1:8080/api/',
        ADMIN_KEY: 'secret-key',
        CONNECTIONS: '50',
        SPREAD_CHECKOUTS: '40',
        CONTENDED_CHECKOUTS: '250',
      }),
    ).toEqual({
      baseUrl: 'http://127.0.0.1:8080/api',
      adminKey: 'secret-key',
      connections: 50,
      spreadCheckouts: 40,
      contendedCheckouts: 250,
    });
  });

  it('refuses a connection count that is not a positive whole number', () => {
    expect(() => readLoadConfig({ CONNECTIONS: '0' })).toThrow(/CONNECTIONS/);
    expect(() => readLoadConfig({ CONNECTIONS: 'twenty' })).toThrow(/CONNECTIONS/);
  });
});
