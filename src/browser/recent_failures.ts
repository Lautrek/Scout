/**
 * Auto-pull "interesting" network entries when a tool throws.
 *
 * Pattern observed today: scripted save/click on X returned 403 first
 * pass, 200 second pass — but the agent's tool result said only "click
 * had no effect". The 403 was sitting in the network log, just not
 * surfaced. This helper picks the most-recent suspicious entries so
 * the error response carries diagnostic context out of the box.
 *
 * Pure: takes a list of network entries + options, returns the subset.
 * Tests drive it with synthetic entry arrays.
 */

export interface NetworkEntryLite {
  t: number;
  method: string;
  url: string;
  status?: number;
  failure?: string;
  duration_ms?: number;
}

export interface PickRecentFailuresOptions {
  /** Look back this many ms from `now`. Default 30000. */
  window_ms?: number;
  /** Reference "now" timestamp. Default Date.now(). */
  now_ms?: number;
  /**
   * Minimum HTTP status to flag as a failure (4xx by default). Setting
   * 0 includes all entries within the window.
   */
  status_min?: number;
  /** Max entries to return. Default 10. */
  limit?: number;
}

/**
 * Pure: filter network entries to "recent failures" — anything in the
 * last window with status >= status_min OR a non-empty failure field.
 *
 * Returns newest-first.
 */
export function pickRecentFailures<T extends NetworkEntryLite>(
  entries: readonly T[],
  opts: PickRecentFailuresOptions = {}
): T[] {
  const windowMs = opts.window_ms ?? 30_000;
  const now = opts.now_ms ?? Date.now();
  const statusMin = opts.status_min ?? 400;
  const limit = opts.limit ?? 10;
  const cutoff = now - windowMs;

  const filtered = entries.filter((e) => {
    if (e.t < cutoff) return false;
    if (e.failure) return true;
    if (typeof e.status === "number" && e.status >= statusMin) return true;
    return false;
  });

  // Newest-first
  filtered.sort((a, b) => b.t - a.t);
  return filtered.slice(0, limit);
}

/**
 * Format a recent-failures snapshot for inclusion in an error response.
 * Strips headers and other heavy fields — caller can request the full
 * entries via scout_network_logs separately.
 */
export interface FailureSummary {
  t: number;
  method: string;
  url: string;
  status?: number;
  failure?: string;
  duration_ms?: number;
}

export function summarizeFailures(
  entries: readonly NetworkEntryLite[]
): FailureSummary[] {
  return entries.map((e) => ({
    t: e.t,
    method: e.method,
    url: e.url,
    status: e.status,
    failure: e.failure,
    duration_ms: e.duration_ms,
  }));
}
