import { Router } from 'express';
import type { Pool } from 'pg';
import { customerIdOf } from '../../http/customer-identity.js';
import { checkOut } from './checkout.service.js';

export function checkoutRouter(db: Pool): Router {
  const router = Router();

  router.post('/carts/:cartId/checkout', async (req, res) => {
    const order = await checkOut(db, {
      cartId: req.params.cartId,
      customerId: customerIdOf(req),
    });
    // A refused checkout is logged by the error handler, with its code and this
    // request's identifier, so every checkout outcome gets exactly one line.
    req.log.info({ orderId: order.id, orderNumber: order.orderNumber }, 'checkout placed');
    res.status(201).json(order);
  });

  return router;
}
