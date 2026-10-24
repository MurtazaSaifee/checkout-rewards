/** The admin report figures the reconciliation reads. Money is in integer cents. */
export interface ReportFigures {
  orderCount: number;
  grossRevenueCents: number;
  discountCents: number;
  netRevenueCents: number;
  unitsSold: readonly { productId: string; quantity: number }[];
}

/** What the store reports at one moment: stock per product, and the admin report. */
export interface StoreSnapshot {
  stock: Readonly<Record<string, number>>;
  report: ReportFigures;
}

/** The orders a run placed, totalled from the 201 responses the checkouts returned. */
export interface PlacedOrders {
  count: number;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  unitsByProduct: Readonly<Record<string, number>>;
}

export interface ReconcileInput {
  before: StoreSnapshot;
  after: StoreSnapshot;
  placed: PlacedOrders;
  /** How many checkouts the run should have placed, worked out from the stock before the run. */
  expectedPlaced: number;
  /** Responses with a 5xx status during the run. */
  serverErrors: number;
}

export interface Check {
  name: string;
  passed: boolean;
  detail: string;
}

/** Compares the store after a load run with the store before it, and with the orders the run placed. */
export function reconcile(input: ReconcileInput): Check[] {
  const stockAfter = Object.values(input.after.stock);
  const negative = stockAfter.filter((units) => units < 0);
  const ordersAdded = input.after.report.orderCount - input.before.report.orderCount;
  return [
    {
      name: 'stock is never negative',
      passed: negative.length === 0,
      detail: negative.length === 0 ? 'every product has zero or more units' : `${negative.length} product(s) below zero`,
    },
    {
      name: 'order count rose by the placed orders',
      passed: ordersAdded === input.placed.count,
      detail: `report rose by ${ordersAdded}, placed ${input.placed.count}`,
    },
    {
      name: 'every expected checkout was placed',
      passed: input.placed.count === input.expectedPlaced,
      detail: `placed ${input.placed.count} of ${input.expectedPlaced} expected`,
    },
    stockTakenCheck(input),
    reportMovedCheck(input),
    reportUnitsCheck(input),
    {
      name: 'no server errors (5xx)',
      passed: input.serverErrors === 0,
      detail: `${input.serverErrors} response(s) with a 5xx status`,
    },
    {
      name: 'net revenue equals gross revenue less discounts',
      passed: input.after.report.netRevenueCents === input.after.report.grossRevenueCents - input.after.report.discountCents,
      detail: `net ${input.after.report.netRevenueCents}, gross ${input.after.report.grossRevenueCents}, discount ${input.after.report.discountCents}`,
    },
  ];
}

/** The report's units sold rose, for each product, by the units on the placed orders. */
function reportUnitsCheck(input: ReconcileInput): Check {
  const productIds = new Set([
    ...input.before.report.unitsSold.map((row) => row.productId),
    ...input.after.report.unitsSold.map((row) => row.productId),
    ...Object.keys(input.placed.unitsByProduct),
  ]);
  const soldBefore = (productId: string) =>
    input.before.report.unitsSold.find((row) => row.productId === productId)?.quantity ?? 0;
  const soldAfter = (productId: string) =>
    input.after.report.unitsSold.find((row) => row.productId === productId)?.quantity ?? 0;
  const mismatched = [...productIds].filter(
    (productId) => soldAfter(productId) - soldBefore(productId) !== (input.placed.unitsByProduct[productId] ?? 0),
  );
  return {
    name: 'report units sold rose by the placed units',
    passed: mismatched.length === 0,
    detail: mismatched.length === 0 ? 'units sold match the placed orders' : `units sold mismatch for ${mismatched.join(', ')}`,
  };
}

/** The report's gross revenue, discounts and net revenue each rose by what the placed orders totalled. */
function reportMovedCheck(input: ReconcileInput): Check {
  const { before, after, placed } = input;
  const gross = after.report.grossRevenueCents - before.report.grossRevenueCents;
  const discount = after.report.discountCents - before.report.discountCents;
  const net = after.report.netRevenueCents - before.report.netRevenueCents;
  const moved = gross === placed.subtotalCents && discount === placed.discountCents && net === placed.totalCents;
  return {
    name: 'report gross, discount and net moved by the placed orders',
    passed: moved,
    detail: `report moved by gross ${gross}, discount ${discount}, net ${net}; placed subtotal ${placed.subtotalCents}, discount ${placed.discountCents}, total ${placed.totalCents}`,
  };
}

/** Stock fell, for each product, by exactly the units on the orders the run placed. */
function stockTakenCheck(input: ReconcileInput): Check {
  const products = Object.keys(input.before.stock);
  const mismatched = products.filter((productId) => {
    const taken = (input.before.stock[productId] ?? 0) - (input.after.stock[productId] ?? 0);
    return taken !== (input.placed.unitsByProduct[productId] ?? 0);
  });
  return {
    name: 'stock fell by the units on the placed orders',
    passed: mismatched.length === 0,
    detail: mismatched.length === 0 ? 'stock taken matches the placed orders' : `stock mismatch for ${mismatched.join(', ')}`,
  };
}
