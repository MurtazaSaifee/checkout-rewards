import { ApiError, type Order } from './api/client';

/** What one request came to: a result to count, and the full detail to show. */
export interface Outcome {
  placed: boolean;
  label: string;
  detail: string;
}

export function placed(order: Order): Outcome {
  return { placed: true, label: 'placed (201)', detail: `order #${order.orderNumber}` };
}

/** Errors are shown in full: the status, the code, the detail and the request identifier. */
export function refusal(error: unknown): Outcome {
  if (error instanceof ApiError && error.problem !== undefined) {
    const { problem } = error;
    return {
      placed: false,
      label: `${error.status} ${problem.code}`,
      detail: `${problem.detail} (requestId ${problem.requestId})`,
    };
  }
  if (error instanceof ApiError) {
    return { placed: false, label: `${error.status}`, detail: error.rawBody };
  }
  return {
    placed: false,
    label: 'not completed',
    detail: error instanceof Error ? error.message : String(error),
  };
}

/** How many outcomes share each label, in the order the labels first appear. */
export function countLabels(outcomes: readonly Outcome[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const outcome of outcomes) {
    counts.set(outcome.label, (counts.get(outcome.label) ?? 0) + 1);
  }
  return [...counts.entries()];
}
