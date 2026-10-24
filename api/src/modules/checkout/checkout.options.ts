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
  /**
   * The total the customer saw, in cents. Absent when the request did not send
   * one, which means no price check: the fingerprint leaves an absent value out,
   * so omitting it and sending it are different requests.
   */
  expectedTotalCents?: number;
}

/**
 * Reads the checkout options from the request body. A missing body and an empty
 * object both mean the defaults, an omitted coupon code means no coupon, and an
 * absent expected total means no price check. The contract has already rejected
 * any other value, so the checks here are backstops, not the validation.
 */
export function checkoutOptionsOf(body: unknown): CheckoutOptions {
  if (body === undefined) {
    return { paymentToken: DEFAULT_PAYMENT_TOKEN };
  }
  if (typeof body !== 'object' || body === null) {
    throw new TypeError('checkout body must be an object');
  }
  const { paymentToken = DEFAULT_PAYMENT_TOKEN, couponCode, expectedTotalCents } = body as {
    paymentToken?: unknown;
    couponCode?: unknown;
    expectedTotalCents?: unknown;
  };
  return {
    paymentToken: paymentTokenOf(paymentToken),
    couponCode: couponCodeOf(couponCode),
    ...(expectedTotalCents === undefined ? {} : { expectedTotalCents: totalCentsOf(expectedTotalCents) }),
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

function totalCentsOf(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`expected total must be a whole number of cents, got ${String(value)}`);
  }
  return value;
}
