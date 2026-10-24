/** The settings of one load run, read from the environment. */
export interface LoadConfig {
  /** The API's base path, without a trailing slash. */
  baseUrl: string;
  adminKey: string;
  /** Concurrent connections autocannon opens against the API. */
  connections: number;
  /** Checkouts spread across the ample-stock products. Undefined sizes the run to the stock available. */
  spreadCheckouts: number | undefined;
  /** Checkouts that contend for the scarce product. */
  contendedCheckouts: number;
}

/** Reads the load run's settings from the environment, refusing values it cannot use. */
export function readLoadConfig(env: Record<string, string | undefined>): LoadConfig {
  return {
    baseUrl: parseBaseUrl(env.BASE_URL ?? 'http://localhost:3000/api'),
    adminKey: env.ADMIN_KEY ?? 'local-admin-key',
    connections: parseCount('CONNECTIONS', env.CONNECTIONS ?? '20'),
    spreadCheckouts: env.SPREAD_CHECKOUTS === undefined ? undefined : parseCount('SPREAD_CHECKOUTS', env.SPREAD_CHECKOUTS),
    contendedCheckouts: parseCount('CONTENDED_CHECKOUTS', env.CONTENDED_CHECKOUTS ?? '100'),
  };
}

function parseBaseUrl(raw: string): string {
  try {
    new URL(raw);
  } catch {
    throw new Error(`BASE_URL must be an absolute URL, got ${JSON.stringify(raw)}`);
  }
  return raw.replace(/\/+$/, '');
}

function parseCount(name: string, raw: string): number {
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || value < 1) {
    throw new Error(`${name} must be a positive whole number, got ${JSON.stringify(raw)}`);
  }
  return value;
}
