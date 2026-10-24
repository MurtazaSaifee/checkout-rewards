import { Router } from 'express';
import type { Pool } from 'pg';
import { listProducts } from './products.repository.js';

export function productsRouter(db: Pool): Router {
  const router = Router();

  router.get('/products', async (_req, res) => {
    const products = await listProducts(db);
    res.json({ products });
  });

  return router;
}
