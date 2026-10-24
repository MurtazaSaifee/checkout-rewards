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

/**
 * Milestones reached by an order count with frequency n: floor(orderCount / n).
 * Order numbers run 1, 2, 3 with no gaps, so milestone k is reached by the order
 * numbered k × n.
 */
export function milestonesReached(orderCount: number, everyN: number): number {
  return Math.floor(orderCount / everyN);
}

/** Whether an order number reaches a milestone: it is a positive multiple of n. */
export function isMilestoneOrder(orderNumber: number, everyN: number): boolean {
  return orderNumber >= 1 && orderNumber % everyN === 0;
}
