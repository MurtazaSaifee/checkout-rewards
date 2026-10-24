import { Router } from 'express';
import type { Pool } from 'pg';
import { customerIdOf } from '../../http/customer-identity.js';
import { listOrders, viewOrder } from './orders.service.js';

export function ordersRouter(db: Pool): Router {
  const router = Router();

  router.get('/orders', async (req, res) => {
    const orders = await listOrders(db, customerIdOf(req));
    res.json({ orders });
  });

  router.get('/orders/:orderId', async (req, res) => {
    const order = await viewOrder(db, req.params.orderId, customerIdOf(req));
    res.json(order);
  });

  return router;
}
