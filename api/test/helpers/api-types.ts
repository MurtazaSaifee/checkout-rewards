/** Shape of an error body as clients receive it (RFC 9457 plus code and requestId). */
export interface Problem {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: string;
  requestId: string;
  errors?: Array<{ path: string; message: string }>;
}

/** Shape of GET /api/products. */
export interface ProductListing {
  products: Array<{ id: string; name: string; unitPriceCents: number; stock: number }>;
}

/** Shape of a cart as every cart operation returns it. */
export interface CartLine {
  productId: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
  lineAmountCents: number;
}

export interface Cart {
  id: string;
  status: 'open' | 'checked_out';
  lines: CartLine[];
  lineCount: number;
  subtotalCents: number;
}

/** The short lines an INSUFFICIENT_STOCK error lists, as the contract describes them. */
export interface ShortLine {
  productId: string;
  requested: number;
  available: number;
}
