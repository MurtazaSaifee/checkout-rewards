/** A product and the units the load run may still take from it. */
export interface StockedProduct {
  id: string;
  stock: number;
}

/**
 * Picks the product for each checkout of a load run: one unit per checkout,
 * round-robin across the products in the order given, and never more units than
 * a product has. Returns fewer than `requested` entries when the stock runs out,
 * so the run is sized to the stock rather than failing part way.
 */
export function spreadCheckouts(products: readonly StockedProduct[], requested: number): string[] {
  const remaining = products.map((product) => product.stock);
  const picks: string[] = [];
  let progressed = true;
  while (picks.length < requested && progressed) {
    progressed = false;
    for (const [index, product] of products.entries()) {
      if (picks.length >= requested) break;
      if ((remaining[index] ?? 0) > 0) {
        remaining[index] = (remaining[index] ?? 0) - 1;
        picks.push(product.id);
        progressed = true;
      }
    }
  }
  return picks;
}
