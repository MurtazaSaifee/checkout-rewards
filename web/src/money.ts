/**
 * Formats integer cents as a dollar string using integer arithmetic only, so
 * the displayed value is exactly the stored value.
 */
export function formatCents(cents: number): string {
  const dollars = Math.trunc(cents / 100);
  const remainder = Math.abs(cents % 100);
  return `$${dollars}.${String(remainder).padStart(2, '0')}`;
}

/**
 * The discount a coupon takes off a subtotal: its percentage of the subtotal,
 * rounded down to a whole cent. This is the rule the server applies, so the total
 * the customer is shown is the total the server charges.
 */
export function discountCents(subtotalCents: number, percentOff: number): number {
  const scaled = subtotalCents * percentOff;
  return (scaled - (scaled % 100)) / 100;
}
