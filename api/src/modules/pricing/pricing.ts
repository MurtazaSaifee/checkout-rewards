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
 * The discount a coupon takes off a subtotal: its percentage of the subtotal,
 * rounded down to a whole cent. The percentage is multiplied first, so the
 * division is by 100 with no fraction left in the product, and the remainder is
 * taken off before dividing. Nothing here goes through floating-point rounding.
 */
export function discountCents(subtotal: number, percentOff: number): number {
  if (!Number.isInteger(percentOff) || percentOff < 0 || percentOff > 100) {
    throw new RangeError(`a percentage must be a whole number from 0 to 100, got ${percentOff}`);
  }
  const scaled = subtotal * percentOff;
  return (scaled - (scaled % 100)) / 100;
}

/** The amounts an order is charged: the subtotal, the discount taken off it, and the total. */
export interface OrderAmounts {
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
}

/**
 * Prices an order from its lines and the percentage of the coupon it redeems, if
 * any. The discount is taken once, on the subtotal, never line by line. The total
 * is the subtotal less the discount, which is never negative because the discount
 * never exceeds the subtotal.
 */
export function priceOrder(lines: readonly PricedLine[], percentOff = 0): OrderAmounts {
  const subtotal = subtotalCents(lines);
  const discount = discountCents(subtotal, percentOff);
  return { subtotalCents: subtotal, discountCents: discount, totalCents: subtotal - discount };
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
