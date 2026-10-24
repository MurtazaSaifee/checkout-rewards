import { useState } from 'react';
import type { CartLine } from './api/client';
import { ErrorDetails } from './ErrorDetails';
import { formatCents } from './money';
import type { CartController } from './useCart';

export function CartPanel({ cart }: { cart: CartController }) {
  const { state, editError } = cart;

  return (
    <section aria-labelledby="cart-heading">
      <header>
        <h2 id="cart-heading">Cart</h2>
        <div>
          {state.kind === 'ready' ? (
            <button type="button" onClick={cart.refresh}>
              Refresh cart
            </button>
          ) : null}{' '}
          <button type="button" onClick={cart.createNewCart}>
            {state.kind === 'none' ? 'Create cart' : 'New cart'}
          </button>
        </div>
      </header>

      {state.kind === 'none' ? <p>This customer has no cart yet.</p> : null}
      {state.kind === 'loading' ? <p>Loading cart…</p> : null}
      {state.kind === 'failed' ? <ErrorDetails error={state.error} /> : null}

      {state.kind === 'ready' ? (
        <>
          <p>
            Cart <code>{state.cart.id}</code> · {state.cart.status} ·{' '}
            {state.cart.lineCount} {state.cart.lineCount === 1 ? 'line' : 'lines'} · subtotal{' '}
            {formatCents(state.cart.subtotalCents)}
          </p>
          {state.cart.status === 'checked_out' ? (
            <p>This cart has been checked out and can no longer be changed.</p>
          ) : null}
          {editError !== undefined ? <ErrorDetails error={editError} /> : null}
          {state.cart.lines.length === 0 ? (
            <p>The cart is empty.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">Unit price</th>
                  <th scope="col">Quantity</th>
                  <th scope="col">Line amount</th>
                  <th scope="col">Remove</th>
                </tr>
              </thead>
              <tbody>
                {state.cart.lines.map((line) => (
                  <CartLineRow
                    // The quantity is part of the key, so the input shows the server's value
                    // again whenever that value changes, for example after a refresh.
                    key={`${line.productId}:${line.quantity}`}
                    line={line}
                    editable={state.cart.status === 'open'}
                    onSetQuantity={cart.setQuantity}
                    onRemove={cart.removeLine}
                  />
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : null}
    </section>
  );
}

function CartLineRow({
  line,
  editable,
  onSetQuantity,
  onRemove,
}: {
  line: CartLine;
  editable: boolean;
  onSetQuantity: (productId: string, quantity: number) => void;
  onRemove: (productId: string) => void;
}) {
  const [quantity, setQuantity] = useState(String(line.quantity));

  return (
    <tr>
      <td>
        {line.name}
        <br />
        <code>{line.productId}</code>
      </td>
      <td>{formatCents(line.unitPriceCents)}</td>
      <td>
        <input
          type="number"
          aria-label={`Quantity of ${line.name} in the cart`}
          value={quantity}
          disabled={!editable}
          onChange={(event) => {
            setQuantity(event.target.value);
          }}
          size={4}
        />{' '}
        <button
          type="button"
          disabled={!editable}
          onClick={() => {
            onSetQuantity(line.productId, Number(quantity));
          }}
        >
          Update
        </button>
      </td>
      <td>{formatCents(line.lineAmountCents)}</td>
      <td>
        <button
          type="button"
          disabled={!editable}
          onClick={() => {
            onRemove(line.productId);
          }}
        >
          Remove
        </button>
      </td>
    </tr>
  );
}
