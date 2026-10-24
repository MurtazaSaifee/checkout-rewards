/**
 * Formats integer cents as a dollar string using integer arithmetic only, so
 * the displayed value is exactly the stored value.
 */
export function formatCents(cents: number): string {
  const dollars = Math.trunc(cents / 100);
  const remainder = Math.abs(cents % 100);
  return `$${dollars}.${String(remainder).padStart(2, '0')}`;
}
