import {
  type ChargeOutcome,
  type ChargeRequest,
  type PaymentGateway,
  type PaymentToken,
} from './payment-gateway.js';

/** The answer the fake gives for each payment token. */
const OUTCOME_BY_TOKEN: Record<PaymentToken, ChargeOutcome> = {
  tok_ok: 'approved',
  tok_decline: 'declined',
};

/**
 * An in-process stand-in for a payment provider. It moves no money: the payment
 * token alone decides the outcome, so a tester can choose approval or decline.
 */
export class FakePaymentGateway implements PaymentGateway {
  charge(request: ChargeRequest): Promise<ChargeOutcome> {
    return Promise.resolve(OUTCOME_BY_TOKEN[request.paymentToken]);
  }
}
