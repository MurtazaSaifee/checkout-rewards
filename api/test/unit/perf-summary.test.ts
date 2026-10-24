import { describe, expect, it } from 'vitest';
import { type RawRun, summariseRun } from '../../perf/summary.js';

const latency = { p50: 40, p90: 80, p97_5: 100, p99: 120, max: 200, average: 45 };

describe('summariseRun', () => {
  it('turns responses over the run duration into requests per second, with counts per status', () => {
    const raw: RawRun = {
      duration: 4,
      errors: 0,
      timeouts: 0,
      latency,
      statusCodeStats: { '409': { count: 97 }, '201': { count: 3 } },
    };

    const summary = summariseRun(raw);

    expect(summary.responses).toBe(100);
    expect(summary.requestsPerSecond).toBe(25);
    expect(summary.statusCounts).toEqual([
      { status: 201, count: 3 },
      { status: 409, count: 97 },
    ]);
  });

  it('counts the responses with a 5xx status as server errors', () => {
    const summary = summariseRun({
      duration: 2,
      errors: 0,
      timeouts: 0,
      latency,
      statusCodeStats: { '201': { count: 5 }, '500': { count: 2 }, '503': { count: 1 } },
    });

    expect(summary.serverErrors).toBe(3);
  });

  it('reports zero requests per second for a run that lasted no time', () => {
    const summary = summariseRun({ duration: 0, errors: 0, timeouts: 0, latency, statusCodeStats: {} });

    expect(summary.requestsPerSecond).toBe(0);
  });
});
