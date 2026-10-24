/**
 * Checkout throughput under load, against an API that is already running.
 *
 *   BASE_URL=http://localhost:3000/api ADMIN_KEY=... npm run perf:checkout -w api
 *
 * Two scenarios run one after the other. Carts are prepared through the API
 * first, then autocannon fires one checkout per cart, each with its own
 * idempotency key. After each scenario the store is read back through the API
 * and checked: stock is never negative, the admin report reconciles with the
 * orders the 201 responses returned, and stock fell by exactly the units sold.
 *
 * Scenario A spreads checkouts across the products with ample stock, sized to
 * the stock available. Scenario B has many checkouts contend for the scarce
 * product, which has three units at seed time. Run it on a freshly seeded
 * database: a second run finds less stock, and an empty scarce product cannot
 * even take its carts.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import autocannon from 'autocannon';
import { type LoadConfig, readLoadConfig } from './config.js';
import { spreadCheckouts } from './plan.js';
import { type Check, type PlacedOrders, type ReportFigures, type StoreSnapshot, reconcile } from './reconcile.js';
import { type RunSummary, summariseRun } from './summary.js';

/** The demo catalogue's scarce product. Seeded with three units. */
const SCARCE_PRODUCT_ID = 'limited-hoodie';

interface ProductRow {
  id: string;
  stock: number;
}

interface Api {
  baseUrl: string;
  adminKey: string;
}

interface ApiRequest {
  method: 'GET' | 'POST' | 'PUT';
  path: string;
  expectStatus: number;
  customerId?: string;
  admin?: boolean;
  body?: unknown;
}

/** One API call. Throws unless the status is the one expected, and names the path, never the admin key. */
async function apiCall(api: Api, request: ApiRequest): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (request.customerId !== undefined) headers['X-Customer-Id'] = request.customerId;
  if (request.admin === true) headers['X-Admin-Key'] = api.adminKey;
  let payload: string | undefined;
  if (request.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(request.body);
  }

  let response: Response;
  try {
    response = await fetch(`${api.baseUrl}${request.path}`, { method: request.method, headers, body: payload });
  } catch (error) {
    throw new Error(`cannot reach the API at ${api.baseUrl}`, { cause: error });
  }
  const text = await response.text();
  if (response.status !== request.expectStatus) {
    throw new Error(`${request.method} ${request.path} answered ${response.status}, expected ${request.expectStatus}: ${text}`);
  }
  return text === '' ? undefined : (JSON.parse(text) as unknown);
}

interface StoreView {
  products: ProductRow[];
  snapshot: StoreSnapshot;
}

/** Reads stock and the admin report through the API. Nothing else is read. */
async function readStore(api: Api): Promise<StoreView> {
  const { products } = (await apiCall(api, { method: 'GET', path: '/products', expectStatus: 200 })) as {
    products: ProductRow[];
  };
  const report = (await apiCall(api, {
    method: 'GET',
    path: '/admin/report',
    admin: true,
    expectStatus: 200,
  })) as ReportFigures;
  return {
    products,
    snapshot: { stock: Object.fromEntries(products.map((product) => [product.id, product.stock])), report },
  };
}

interface PreparedCart {
  cartId: string;
}

/** One cart per planned checkout, each holding one unit of its product. Carts are created and set through the API. */
async function prepareCarts(api: Api, customerId: string, productIds: readonly string[]): Promise<PreparedCart[]> {
  const carts: PreparedCart[] = [];
  for (const productId of productIds) {
    const created = (await apiCall(api, {
      method: 'POST',
      path: '/carts',
      customerId,
      expectStatus: 201,
    })) as { id: string };
    await apiCall(api, {
      method: 'PUT',
      path: `/carts/${created.id}/lines/${productId}`,
      customerId,
      body: { quantity: 1 },
      expectStatus: 200,
    });
    carts.push({ cartId: created.id });
  }
  return carts;
}

/** The part of a 201 checkout response the reconciliation reads. */
interface PlacedOrderBody {
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  lines: { productId: string; quantity: number }[];
}

interface FireResult {
  raw: autocannon.Result;
  placed: PlacedOrders;
}

/**
 * Fires one checkout per prepared cart, each with a unique idempotency key, and
 * totals every order the 201 responses return. autocannon calls setupRequest
 * once per request it sends, so each cart is used exactly once.
 */
async function fireCheckouts(config: LoadConfig, customerId: string, carts: readonly PreparedCart[]): Promise<FireResult> {
  const target = new URL(config.baseUrl);
  const accumulated = {
    count: 0,
    subtotalCents: 0,
    discountCents: 0,
    totalCents: 0,
    unitsByProduct: {} as Record<string, number>,
  };
  let nextCart = 0;

  const raw = await autocannon({
    url: target.origin,
    connections: Math.min(config.connections, carts.length),
    amount: carts.length,
    // autocannon checks for the end of a run only on each sample tick, and its
    // default tick is one second, which rounds every run up to a whole second.
    sampleInt: 10,
    requests: [
      {
        method: 'POST',
        setupRequest: (request) => {
          const cart = carts[nextCart];
          nextCart += 1;
          if (cart === undefined) {
            throw new Error('more checkouts were fired than carts were prepared');
          }
          return {
            ...request,
            path: `${target.pathname.replace(/\/$/, '')}/carts/${cart.cartId}/checkout`,
            headers: { 'X-Customer-Id': customerId, 'Idempotency-Key': randomUUID() },
          };
        },
        onResponse: (status, body) => {
          if (status !== 201) return;
          const order = JSON.parse(body) as PlacedOrderBody;
          accumulated.count += 1;
          accumulated.subtotalCents += order.subtotalCents;
          accumulated.discountCents += order.discountCents;
          accumulated.totalCents += order.totalCents;
          for (const line of order.lines) {
            accumulated.unitsByProduct[line.productId] = (accumulated.unitsByProduct[line.productId] ?? 0) + line.quantity;
          }
        },
      },
    ],
  });

  return {
    raw,
    placed: {
      count: accumulated.count,
      subtotalCents: accumulated.subtotalCents,
      discountCents: accumulated.discountCents,
      totalCents: accumulated.totalCents,
      unitsByProduct: accumulated.unitsByProduct,
    },
  };
}

interface Scenario {
  title: string;
  productIds: readonly string[];
  /** How many checkouts should place an order, worked out from the stock before the run. */
  expectedPlaced: (before: StoreSnapshot) => number;
}

/** Runs one scenario and prints its figures and checks. Returns true when every check passed. */
async function runScenario(api: Api, config: LoadConfig, customerId: string, scenario: Scenario): Promise<boolean> {
  const before = (await readStore(api)).snapshot;

  const setupStarted = Date.now();
  const carts = await prepareCarts(api, customerId, scenario.productIds);
  const setupSeconds = (Date.now() - setupStarted) / 1000;

  const { raw, placed } = await fireCheckouts(config, customerId, carts);
  const after = (await readStore(api)).snapshot;

  const summary = summariseRun(raw);
  const checks = reconcile({
    before,
    after,
    placed,
    expectedPlaced: scenario.expectedPlaced(before),
    serverErrors: summary.serverErrors,
  });
  printScenario(scenario.title, config, carts.length, setupSeconds, summary, checks);
  return checks.every((check) => check.passed);
}

function printScenario(
  title: string,
  config: LoadConfig,
  checkouts: number,
  setupSeconds: number,
  summary: RunSummary,
  checks: readonly Check[],
): void {
  const ms = (value: number): string => value.toFixed(1);
  const { latencyMs } = summary;
  const responses = summary.statusCounts.map((row) => `${row.status} x ${row.count}`).join(', ') || 'none';

  console.log(`\n${title}`);
  console.log(`  carts prepared through the API  ${checkouts} in ${setupSeconds.toFixed(2)} s`);
  console.log(
    `  requests per second             ${summary.requestsPerSecond.toFixed(1)} ` +
      `(${summary.responses} responses in ${summary.durationSeconds.toFixed(2)} s, ${Math.min(config.connections, checkouts)} connections)`,
  );
  console.log(
    `  latency (ms)                    p50 ${ms(latencyMs.p50)}  p90 ${ms(latencyMs.p90)}  ` +
      `p97.5 ${ms(latencyMs.p97_5)}  p99 ${ms(latencyMs.p99)}  max ${ms(latencyMs.max)}  avg ${ms(latencyMs.average)}`,
  );
  console.log(`  responses by status             ${responses}`);
  console.log(`  connection errors / timeouts    ${summary.errors} / ${summary.timeouts}`);
  console.log('  checks');
  for (const check of checks) {
    console.log(`    ${check.passed ? 'PASS' : 'FAIL'}  ${check.name}: ${check.detail}`);
  }
}

async function main(): Promise<void> {
  const config = readLoadConfig(process.env);
  const api: Api = { baseUrl: config.baseUrl, adminKey: config.adminKey };
  const customerId = `perf-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;

  console.log(`Checkout throughput against ${config.baseUrl}, ${config.connections} connections`);
  // Fail early and clearly when the API is down or the admin key is refused.
  await apiCall(api, { method: 'GET', path: '/products', expectStatus: 200 });
  const { products } = await readStore(api);

  const scarce = products.find((product) => product.id === SCARCE_PRODUCT_ID);
  if (scarce === undefined) {
    throw new Error(`the catalogue has no ${SCARCE_PRODUCT_ID} product; this script expects the demo seed`);
  }
  const ample = products.filter((product) => product.id !== SCARCE_PRODUCT_ID && product.stock > 0);

  const scenarios: Scenario[] = [];
  const spread = spreadCheckouts(ample, config.spreadCheckouts ?? Number.POSITIVE_INFINITY);
  if (spread.length === 0) {
    console.log('\nScenario A skipped: no ample-stock units are left. Run on a freshly seeded database.');
  } else {
    scenarios.push({
      title: `Scenario A: ${spread.length} checkouts spread across ample-stock products`,
      productIds: spread,
      expectedPlaced: () => spread.length,
    });
  }
  if (scarce.stock === 0) {
    console.log(`\nScenario B skipped: ${SCARCE_PRODUCT_ID} is sold out. Run on a freshly seeded database.`);
  } else {
    const contended = Array.from({ length: config.contendedCheckouts }, () => SCARCE_PRODUCT_ID);
    scenarios.push({
      title: `Scenario B: ${contended.length} checkouts contending for ${SCARCE_PRODUCT_ID} (${scarce.stock} in stock)`,
      productIds: contended,
      expectedPlaced: (before) => Math.min(contended.length, before.stock[SCARCE_PRODUCT_ID] ?? 0),
    });
  }

  let allPassed = true;
  for (const scenario of scenarios) {
    allPassed = (await runScenario(api, config, customerId, scenario)) && allPassed;
  }
  console.log(allPassed ? '\nAll checks passed.' : '\nSome checks failed.');
  process.exitCode = allPassed ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error(`checkout throughput run failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
