import { Router } from 'express';
import type { Pool } from 'pg';
import { customerIdOf } from '../../http/customer-identity.js';
import { createCart, viewCart } from './carts.service.js';

export function cartsRouter(db: Pool): Router {
  const router = Router();

  router.post('/carts', async (req, res) => {
    const cart = await createCart(db, customerIdOf(req));
    res.status(201).json(cart);
  });

  router.get('/carts/:cartId', async (req, res) => {
    const cart = await viewCart(db, req.params.cartId, customerIdOf(req));
    res.json(cart);
  });

  return router;
}
