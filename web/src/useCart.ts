import { useCallback, useEffect, useState } from 'react';
import {
  type Cart,
  createCart,
  getCart,
  removeCartLine,
  setCartLineQuantity,
} from './api/client';
import { type CustomerId, loadCartId, saveCartId } from './customer';

/** What the cart panel shows for one customer. */
export type CartState =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'ready'; cart: Cart }
  | { kind: 'failed'; error: unknown };

export interface CartController {
  state: CartState;
  /** The last edit that failed. The cart itself is unchanged, so it stays on screen. */
  editError: unknown;
  createNewCart: () => void;
  refresh: () => void;
  setQuantity: (productId: string, quantity: number) => void;
  removeLine: (productId: string) => void;
}

/**
 * Owns one customer's cart on the screen. The cart this browser remembers for
 * the customer is loaded once; after that every change comes back from the
 * server, so what is shown is what the server holds.
 */
export function useCart(customer: CustomerId): CartController {
  const [state, setState] = useState<CartState>(() =>
    loadCartId(customer) === undefined ? { kind: 'none' } : { kind: 'loading' },
  );
  const [editError, setEditError] = useState<unknown>(undefined);

  useEffect(() => {
    const cartId = loadCartId(customer);
    if (cartId === undefined) return;

    const controller = new AbortController();
    getCart(customer, cartId, controller.signal).then(
      (cart) => {
        setState({ kind: 'ready', cart });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ kind: 'failed', error });
      },
    );
    return () => {
      controller.abort();
    };
  }, [customer]);

  const createNewCart = useCallback(() => {
    setEditError(undefined);
    setState({ kind: 'loading' });
    createCart(customer).then(
      (cart) => {
        saveCartId(customer, cart.id);
        setState({ kind: 'ready', cart });
      },
      (error: unknown) => {
        setState({ kind: 'failed', error });
      },
    );
  }, [customer]);

  const refresh = useCallback(() => {
    if (state.kind !== 'ready') return;
    setEditError(undefined);
    getCart(customer, state.cart.id).then(
      (cart) => {
        setState({ kind: 'ready', cart });
      },
      (error: unknown) => {
        setState({ kind: 'failed', error });
      },
    );
  }, [customer, state]);

  const edit = useCallback(
    (request: (cartId: string) => Promise<Cart>) => {
      if (state.kind !== 'ready') return;
      setEditError(undefined);
      request(state.cart.id).then(
        (cart) => {
          setState({ kind: 'ready', cart });
        },
        (error: unknown) => {
          setEditError(error);
        },
      );
    },
    [state],
  );

  const setQuantity = useCallback(
    (productId: string, quantity: number) => {
      edit((cartId) => setCartLineQuantity(customer, cartId, productId, quantity));
    },
    [customer, edit],
  );

  const removeLine = useCallback(
    (productId: string) => {
      edit((cartId) => removeCartLine(customer, cartId, productId));
    },
    [customer, edit],
  );

  return { state, editError, createNewCart, refresh, setQuantity, removeLine };
}
