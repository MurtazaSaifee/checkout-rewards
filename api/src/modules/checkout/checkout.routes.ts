import { Router, type Request } from 'express';
import type { Pool } from 'pg';
import { DomainError } from '../../errors.js';
import { customerIdOf } from '../../http/customer-identity.js';
import { idempotencyKeyOf } from '../../http/idempotency-key.js';
import { checkoutOptionsOf } from './checkout.options.js';
import { type CheckoutOutcome, checkOut } from './checkout.service.js';

/** The message of every checkout outcome line. Its `code` says what happened. */
const OUTCOME_MESSAGE = 'checkout outcome';

/**
 * Each checkout writes one outcome line, with a code: ORDER_PLACED for a new order,
 * IDEMPOTENT_REPLAY for a retry answered from the stored response, or the error code
 * for a refusal. The error handler then leaves that refusal unlogged.
 */
export function checkoutRouter(db: Pool): Router {
  const router = Router();

  router.post('/carts/:cartId/checkout', async (req, res) => {
    const { cartId } = req.params;
    const idempotencyKey = idempotencyKeyOf(req);

    let outcome: CheckoutOutcome;
    try {
      outcome = await checkOut(db, {
        cartId,
        customerId: customerIdOf(req),
        idempotencyKey,
        options: checkoutOptionsOf(req.body),
      });
    } catch (error) {
      if (error instanceof DomainError) {
        logOutcome(req, { code: error.code, status: error.status, cartId, idempotencyKey });
        res.locals.outcomeLogged = true;
      }
      throw error;
    }

    logOutcome(req, {
      code: outcome.replayed ? 'IDEMPOTENT_REPLAY' : 'ORDER_PLACED',
      status: outcome.status,
      cartId,
      idempotencyKey,
      orderId: outcome.order.id,
      orderNumber: outcome.order.orderNumber,
    });
    res.status(outcome.status).json(outcome.order);
  });

  return router;
}

function logOutcome(req: Request, fields: Record<string, unknown>): void {
  req.log.info(fields, OUTCOME_MESSAGE);
}
