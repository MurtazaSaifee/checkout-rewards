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

/** A line as an order records it: the name and price as they were at checkout. */
export interface OrderLine {
  productId: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
  lineAmountCents: number;
}

/** The order a successful checkout places, and the shape of each order a customer views. */
export interface Order {
  id: string;
  orderNumber: number;
  placedAt: string;
  lines: OrderLine[];
  subtotalCents: number;
  couponCode: string | null;
  couponPercentOff: number | null;
  discountCents: number;
  totalCents: number;
}

/** The short lines an INSUFFICIENT_STOCK error lists, as the contract describes them. */
export interface ShortLine {
  productId: string;
  requested: number;
  available: number;
}

/** A coupon as its customer sees it. */
export interface Coupon {
  code: string;
  percentOff: number;
  milestone: number;
  redeemed: boolean;
}

/** The response to generating a coupon. */
export interface GeneratedCoupon {
  coupon: Coupon;
  customerId: string;
  unrewardedMilestonesRemaining: number;
}

/** A coupon as an administrator sees it, with the customer it was issued to. */
export interface AdminCoupon {
  code: string;
  percentOff: number;
  milestone: number;
  customerId: string;
  issuedAt: string;
  redeemedByOrderId: string | null;
}

/** An order as the administrator sees it: the order a customer views, with the customer it belongs to. */
export interface AdminOrder extends Order {
  customerId: string;
}

/** The units sold of one product across every placed order. */
export interface UnitsSold {
  productId: string;
  name: string;
  quantity: number;
}

/** The admin report, calculated from orders and coupons on every request. */
export interface Report {
  orderCount: number;
  unitsSold: UnitsSold[];
  grossRevenueCents: number;
  discountCents: number;
  netRevenueCents: number;
  couponsGenerated: number;
  couponsRedeemed: number;
  couponsAvailable: number;
  unrewardedMilestones: number;
}
