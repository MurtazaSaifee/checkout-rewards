import { useCallback, useEffect, useState } from 'react';
import { ApiError, listProducts, type Product } from './api/client';
import { formatCents } from './money';

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; products: Product[] }
  | { kind: 'failed'; error: unknown };

export function App() {
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
  }, [attempt]);

  const reload = useCallback(() => {
    setLoad({ kind: 'loading' });
    setAttempt((count) => count + 1);
  }, []);

  return (
    <main>
      <header>
        <h1>Checkout and Rewards</h1>
        <button type="button" onClick={reload}>
          Refresh products
        </button>
      </header>

      <Products load={load} />
    </main>
  );
}

function Products({ load }: { load: Load }) {
  if (load.kind === 'loading') {
    return <p>Loading products…</p>;
  }
  if (load.kind === 'failed') {
    return <ErrorDetails error={load.error} />;
  }

  return (
    <table>
      <thead>
        <tr>
          <th scope="col">Product</th>
          <th scope="col">Id</th>
          <th scope="col">Unit price</th>
          <th scope="col">Stock</th>
        </tr>
      </thead>
      <tbody>
        {load.products.map((product) => (
          <tr key={product.id}>
            <td>{product.name}</td>
            <td>
              <code>{product.id}</code>
            </td>
            <td>{formatCents(product.unitPriceCents)}</td>
            <td>{product.stock}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Errors are shown in full, never reduced to a friendly message. */
function ErrorDetails({ error }: { error: unknown }) {
  if (error instanceof ApiError) {
    return (
      <section role="alert">
        <p>
          Status {error.status}
          {error.problem ? ` · code ${error.problem.code}` : ''}
        </p>
        {error.problem ? (
          <dl>
            <dt>detail</dt>
            <dd>{error.problem.detail}</dd>
            <dt>requestId</dt>
            <dd>
              <code>{error.problem.requestId}</code>
            </dd>
          </dl>
        ) : null}
        <pre>{error.rawBody}</pre>
      </section>
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  return (
    <section role="alert">
      <p>Request did not complete: {message}</p>
    </section>
  );
}
