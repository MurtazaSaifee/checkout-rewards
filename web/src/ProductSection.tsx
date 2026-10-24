import { useEffect, useState } from 'react';
import { listProducts, type Product } from './api/client';
import { ErrorDetails } from './ErrorDetails';
import { formatCents } from './money';
import type { CartController } from './useCart';

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; products: Product[] }
  | { kind: 'failed'; error: unknown };

/** stockVersion changes whenever an order may have changed stock, so the list is read again. */
export function ProductSection({ cart, stockVersion }: { cart: CartController; stockVersion: number }) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    listProducts(controller.signal).then(
      (list) => {
        setLoad({ kind: 'ready', products: list.products });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setLoad({ kind: 'failed', error });
      },
    );
    return () => {
      controller.abort();
    };
  }, [attempt, stockVersion]);

  const canAdd = cart.state.kind === 'ready';

  return (
    <section aria-labelledby="products-heading">
      <header>
        <h2 id="products-heading">Products</h2>
        <button
          type="button"
          onClick={() => {
            setLoad({ kind: 'loading' });
            setAttempt((count) => count + 1);
          }}
        >
          Refresh products
        </button>
      </header>

      {load.kind === 'loading' ? <p>Loading products…</p> : null}
      {load.kind === 'failed' ? <ErrorDetails error={load.error} /> : null}
      {load.kind === 'ready' ? (
        <>
          {canAdd ? null : <p>Create a cart to add products.</p>}
          <table>
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col">Id</th>
                <th scope="col">Unit price</th>
                <th scope="col">Stock</th>
                <th scope="col">Add to cart</th>
              </tr>
            </thead>
            <tbody>
              {load.products.map((product) => (
                <ProductRow
                  key={product.id}
                  product={product}
                  canAdd={canAdd}
                  onAdd={(quantity) => {
                    cart.setQuantity(product.id, quantity);
                  }}
                />
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </section>
  );
}

/**
 * Adding to the cart sets the quantity, as the cart does. The quantity is sent
 * as typed, so an invalid value is rejected by the server and shown in full.
 */
function ProductRow({
  product,
  canAdd,
  onAdd,
}: {
  product: Product;
  canAdd: boolean;
  onAdd: (quantity: number) => void;
}) {
  const [quantity, setQuantity] = useState('1');

  return (
    <tr>
      <td>{product.name}</td>
      <td>
        <code>{product.id}</code>
      </td>
      <td>{formatCents(product.unitPriceCents)}</td>
      <td>{product.stock}</td>
      <td>
        <label>
          Quantity{' '}
          <input
            type="number"
            aria-label={`Quantity of ${product.name}`}
            value={quantity}
            onChange={(event) => {
              setQuantity(event.target.value);
            }}
            size={4}
          />
        </label>{' '}
        <button
          type="button"
          disabled={!canAdd}
          onClick={() => {
            onAdd(Number(quantity));
          }}
        >
          Add to cart
        </button>
      </td>
    </tr>
  );
}
