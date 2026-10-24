/**
 * The fields of an autocannon result the report reads. Latencies are in
 * milliseconds and the duration is in seconds. autocannon's result satisfies
 * this shape, so the summary does not depend on the library's types.
 */
export interface RawRun {
  duration: number;
  errors: number;
  timeouts: number;
  latency: {
    average: number;
    max: number;
    p50: number;
    p90: number;
    p97_5: number;
    p99: number;
  };
  statusCodeStats?: { readonly [status: string]: { count?: number } | undefined };
}

export interface RunSummary {
  durationSeconds: number;
  responses: number;
  requestsPerSecond: number;
  latencyMs: RawRun['latency'];
  statusCounts: { status: number; count: number }[];
  serverErrors: number;
  errors: number;
  timeouts: number;
}

/** Summarises one load run: responses over the run's duration, latencies, and the count of each status. */
export function summariseRun(raw: RawRun): RunSummary {
  const statusCounts = Object.entries(raw.statusCodeStats ?? {})
    .map(([status, stats]) => ({ status: Number(status), count: stats?.count ?? 0 }))
    .sort((a, b) => a.status - b.status);
  const responses = statusCounts.reduce((total, row) => total + row.count, 0);
  return {
    durationSeconds: raw.duration,
    responses,
    requestsPerSecond: raw.duration > 0 ? responses / raw.duration : 0,
    latencyMs: raw.latency,
    statusCounts,
    serverErrors: statusCounts.filter((row) => row.status >= 500).reduce((total, row) => total + row.count, 0),
    errors: raw.errors,
    timeouts: raw.timeouts,
  };
}
