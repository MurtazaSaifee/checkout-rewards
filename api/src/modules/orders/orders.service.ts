import type { Pool } from 'pg';
import { OrderNotFoundError } from './order.errors.js';
import {
  type AdminOrderView,
  findOwnedOrderView,
  listAllOrderViews,
  listOwnedOrderViews,
  type OrderView,
} from './orders.repository.js';

/** One order the customer placed. */
export async function viewOrder(db: Pool, orderId: string, customerId: string): Promise<OrderView> {
  const order = await findOwnedOrderView(db, orderId, customerId);
  if (order === undefined) {
    throw new OrderNotFoundError();
  }
  return order;
}

/** Every order the customer placed, oldest first. */
export function listOrders(db: Pool, customerId: string): Promise<OrderView[]> {
  return listOwnedOrderViews(db, customerId);
}

/** Every order placed by any customer, oldest first, each with the customer it belongs to. */
export function listAllOrders(db: Pool): Promise<AdminOrderView[]> {
  return listAllOrderViews(db);
}
