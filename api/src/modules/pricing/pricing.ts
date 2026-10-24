/**
 * Pure pricing arithmetic. No I/O: callers pass in the unit prices they have
 * read, and every amount is an integer number of cents.
 */

export interface PricedLine {
  unitPriceCents: number;
  quantity: number;
}

/** The amount for one cart line: unit price times quantity. */
export function lineAmountCents(line: PricedLine): number {
  return line.unitPriceCents * line.quantity;
}

/** The sum of every line amount. An empty cart has a subtotal of zero. */
export function subtotalCents(lines: readonly PricedLine[]): number {
  return lines.reduce((sum, line) => sum + lineAmountCents(line), 0);
}
