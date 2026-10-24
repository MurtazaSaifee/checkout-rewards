import { ApiError } from './api/client';

/** Errors are shown in full, never reduced to a friendly message. */
export function ErrorDetails({ error }: { error: unknown }) {
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
