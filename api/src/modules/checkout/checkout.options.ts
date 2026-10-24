import {
  DEFAULT_PAYMENT_TOKEN,
  PAYMENT_TOKENS,
  type PaymentToken,
} from '../payments/payment-gateway.js';

/**
 * The options a checkout request carries, with every default applied. The
 * fingerprint of a request is built from this value, not from the raw body, so
 * an omitted option and its default are the same request. An option added later
 * is read here with its default, and it then takes part in the fingerprint.
 */
export interface CheckoutOptions {
  paymentToken: PaymentToken;
  /** The coupon the customer redeems with this checkout. Absent when none is given. */
  couponCode?: string;
}

/**
 * Reads the checkout options from the request body. A missing body and an empty
 * object both mean the defaults, and an omitted coupon code means no coupon. The
 * contract has already rejected anything else, so the checks here are backstops.
 */
export function checkoutOptionsOf(body: unknown): CheckoutOptions {
  if (body === undefined) {
    return { paymentToken: DEFAULT_PAYMENT_TOKEN };
  }
  if (typeof body !== 'object' || body === null) {
    throw new TypeError('checkout body must be an object');
  }
  const { paymentToken = DEFAULT_PAYMENT_TOKEN, couponCode } = body as {
    paymentToken?: unknown;
    couponCode?: unknown;
  };
  return {
    paymentToken: paymentTokenOf(paymentToken),
    couponCode: couponCodeOf(couponCode),
  };
}

function couponCodeOf(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('coupon code must be a non-empty string');
  }
  return value;
}

function paymentTokenOf(value: unknown): PaymentToken {
  const token = PAYMENT_TOKENS.find((candidate) => candidate === value);
  if (token === undefined) {
    throw new TypeError(`unknown payment token ${String(value)}`);
  }
  return token;
}
