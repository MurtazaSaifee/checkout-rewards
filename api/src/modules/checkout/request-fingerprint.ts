import { createHash } from 'node:crypto';
import type { CheckoutOptions } from './checkout.options.js';

export interface CheckoutRequestIdentity {
  cartId: string;
  options: CheckoutOptions;
}

/**
 * A digest of what a checkout request asks for: the cart and every option, with
 * defaults applied. Two requests with the same fingerprint are the same checkout,
 * so a retry may replay the first one's response. The digest covers the whole
 * options object, so an option added later changes it without any change here.
 */
export function requestFingerprint(request: CheckoutRequestIdentity): string {
  const identity = {
    // Identifiers are case-insensitive UUIDs, so their case is not part of the request.
    cartId: request.cartId.toLowerCase(),
    options: request.options,
  };
  return createHash('sha256').update(canonicalJson(identity)).digest('hex');
}

/**
 * JSON with object keys in sorted order, so equal values always produce the same
 * text. Properties whose value is undefined are left out, as JSON.stringify does.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item: unknown) => canonicalJson(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const members = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${members.join(',')}}`;
}
