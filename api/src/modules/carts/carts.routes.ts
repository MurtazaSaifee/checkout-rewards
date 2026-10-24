import { Router } from 'express';
import type { Pool } from 'pg';
import { customerIdOf } from '../../http/customer-identity.js';
import { createCart, setLineQuantity, viewCart } from './carts.service.js';

/** The request body after the contract has validated it against SetLineQuantity. */
interface SetLineQuantityBody {
  quantity: number;
}

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

  router.put('/carts/:cartId/lines/:productId', async (req, res) => {
    const { quantity } = req.body as SetLineQuantityBody;
    const cart = await setLineQuantity(db, {
      cartId: req.params.cartId,
      customerId: customerIdOf(req),
      productId: req.params.productId,
      quantity,
    });
    res.json(cart);
  });

  return router;
}
