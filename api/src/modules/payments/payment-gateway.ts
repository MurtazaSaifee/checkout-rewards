/** The payment tokens a checkout may name. The contract lists the same values. */
export const PAYMENT_TOKENS = ['tok_ok', 'tok_decline'] as const;
export type PaymentToken = (typeof PAYMENT_TOKENS)[number];

/** The token a checkout uses when its request names none. */
export const DEFAULT_PAYMENT_TOKEN: PaymentToken = 'tok_ok';

export interface ChargeRequest {
  amountCents: number;
  paymentToken: PaymentToken;
}

export type ChargeOutcome = 'approved' | 'declined';

/**
 * The payment gateway: a single charge operation. Checkout calls it inside its
 * transaction. The only implementation is the in-process fake.
 */
export interface PaymentGateway {
  charge(request: ChargeRequest): Promise<ChargeOutcome>;
}
