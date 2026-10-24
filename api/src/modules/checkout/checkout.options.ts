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
}

/**
 * Reads the checkout options from the request body. A missing body and an empty
 * object both mean the defaults. The contract has already rejected any other
 * payment token, so the check here is a backstop, not the validation.
 */
export function checkoutOptionsOf(body: unknown): CheckoutOptions {
  if (body === undefined) {
    return { paymentToken: DEFAULT_PAYMENT_TOKEN };
  }
  if (typeof body !== 'object' || body === null) {
    throw new TypeError('checkout body must be an object');
  }
  const { paymentToken = DEFAULT_PAYMENT_TOKEN } = body as { paymentToken?: unknown };
  return { paymentToken: paymentTokenOf(paymentToken) };
}

function paymentTokenOf(value: unknown): PaymentToken {
  const token = PAYMENT_TOKENS.find((candidate) => candidate === value);
  if (token === undefined) {
    throw new TypeError(`unknown payment token ${String(value)}`);
  }
  return token;
}
