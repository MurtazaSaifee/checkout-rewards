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
