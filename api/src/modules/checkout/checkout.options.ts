/**
 * The options a checkout request carries, with every default applied. The
 * fingerprint of a request is built from this value, not from the raw body, so
 * an omitted option and its default are the same request. An option added later
 * is read here with its default, and it then takes part in the fingerprint.
 */
export type CheckoutOptions = Record<string, never>;

/**
 * Reads the checkout options from the request body. The contract accepts only an
 * empty object, so there is nothing to read yet, and a missing body is the same as
 * an empty one.
 */
export function checkoutOptionsOf(body: unknown): CheckoutOptions {
  if (body !== undefined && (typeof body !== 'object' || body === null)) {
    throw new TypeError('checkout body must be an object');
  }
  return {};
}
