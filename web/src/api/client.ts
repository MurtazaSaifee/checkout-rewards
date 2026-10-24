import type { components } from './schema.gen';

/** Types come from the OpenAPI document, so a contract change breaks this build. */
export type Product = components['schemas']['Product'];
export type ProductList = components['schemas']['ProductList'];
export type Problem = components['schemas']['Problem'];

/** Thrown for any non-2xx answer. Keeps the full body so the UI can show it raw. */
export class ApiError extends Error {
  readonly status: number;
  readonly problem: Problem | undefined;
  readonly rawBody: string;

  constructor(status: number, rawBody: string) {
    super(`Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.rawBody = rawBody;
    this.problem = parseProblem(rawBody);
  }
}

/** Relative path: Vite proxies /api in development, nginx does so in Compose. */
const API_BASE = '/api';

export async function listProducts(signal?: AbortSignal): Promise<ProductList> {
  const response = await fetch(`${API_BASE}/products`, {
    headers: { Accept: 'application/json' },
    signal,
  });
  return readJson<ProductList>(response);
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    throw new ApiError(response.status, text);
  }
  return JSON.parse(text) as T;
}

function parseProblem(rawBody: string): Problem | undefined {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    return isProblem(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isProblem(value: unknown): value is Problem {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof value.code === 'string' &&
    'requestId' in value &&
    typeof value.requestId === 'string'
  );
}
