import { describe, expect, it } from "vitest";
import {
  pickRecentFailures,
  summarizeFailures,
  type NetworkEntryLite,
} from "../../src/browser/recent_failures.js";

const NOW = 1_000_000;

function entry(overrides: Partial<NetworkEntryLite>): NetworkEntryLite {
  return {
    t: NOW,
    method: "GET",
    url: "https://example.com/",
    ...overrides,
  };
}

describe("pickRecentFailures", () => {
  it("returns nothing on an empty log", () => {
    expect(pickRecentFailures([], { now_ms: NOW })).toEqual([]);
  });

  it("returns nothing when no recent entries are failures", () => {
    const log = [
      entry({ status: 200 }),
      entry({ status: 304 }),
      entry({ status: 200 }),
    ];
    expect(pickRecentFailures(log, { now_ms: NOW })).toEqual([]);
  });

  it("includes 4xx responses", () => {
    const log = [entry({ url: "/x", status: 403 })];
    const result = pickRecentFailures(log, { now_ms: NOW });
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe(403);
  });

  it("includes 5xx responses", () => {
    const log = [entry({ url: "/y", status: 500 })];
    expect(pickRecentFailures(log, { now_ms: NOW })).toHaveLength(1);
  });

  it("includes entries with a failure field even without a status", () => {
    const log = [entry({ url: "/z", failure: "net::ERR_CONNECTION_REFUSED" })];
    const result = pickRecentFailures(log, { now_ms: NOW });
    expect(result).toHaveLength(1);
    expect(result[0].failure).toBe("net::ERR_CONNECTION_REFUSED");
  });

  it("excludes entries older than the lookback window", () => {
    const log = [
      entry({ t: NOW - 60_000, status: 500 }), // outside default 30s
      entry({ t: NOW - 5_000, status: 500 }), // inside
    ];
    const result = pickRecentFailures(log, { now_ms: NOW });
    expect(result).toHaveLength(1);
    expect(result[0].t).toBe(NOW - 5_000);
  });

  it("respects custom window_ms", () => {
    const log = [
      entry({ t: NOW - 60_000, status: 500 }),
      entry({ t: NOW - 5_000, status: 500 }),
    ];
    const result = pickRecentFailures(log, { now_ms: NOW, window_ms: 90_000 });
    expect(result).toHaveLength(2);
  });

  it("respects custom status_min", () => {
    const log = [
      entry({ status: 304 }),
      entry({ status: 401 }),
      entry({ status: 500 }),
    ];
    // status_min=500 picks only the 500
    const result = pickRecentFailures(log, { now_ms: NOW, status_min: 500 });
    expect(result.map((r) => r.status)).toEqual([500]);
  });

  it("returns newest-first", () => {
    const log = [
      entry({ t: NOW - 10_000, status: 500, url: "/a" }),
      entry({ t: NOW - 1_000, status: 403, url: "/b" }),
      entry({ t: NOW - 5_000, status: 502, url: "/c" }),
    ];
    const result = pickRecentFailures(log, { now_ms: NOW });
    expect(result.map((r) => r.url)).toEqual(["/b", "/c", "/a"]);
  });

  it("respects the limit", () => {
    const log = Array.from({ length: 50 }, (_, i) =>
      entry({ t: NOW - i * 100, status: 500, url: `/n${i}` })
    );
    const result = pickRecentFailures(log, { now_ms: NOW, limit: 5 });
    expect(result).toHaveLength(5);
    // Newest five
    expect(result.map((r) => r.url)).toEqual(["/n0", "/n1", "/n2", "/n3", "/n4"]);
  });

  it("status_min=0 returns all in-window entries (success and fail)", () => {
    const log = [
      entry({ status: 200 }),
      entry({ status: 200 }),
      entry({ status: 500 }),
    ];
    // status_min=0: every entry has status >= 0 → all match
    const result = pickRecentFailures(log, { now_ms: NOW, status_min: 0 });
    expect(result).toHaveLength(3);
  });

  it("does not flag a 200 response as a failure", () => {
    const log = [entry({ status: 200 })];
    expect(pickRecentFailures(log, { now_ms: NOW })).toEqual([]);
  });
});

describe("summarizeFailures", () => {
  it("strips heavy fields and keeps only the diagnostic ones", () => {
    const entries: any[] = [
      {
        t: 1,
        method: "POST",
        url: "https://x.com/api/save",
        status: 403,
        failure: undefined,
        duration_ms: 234,
        request_headers: { cookie: "...secret..." },
        response_headers: { "x-rate-limit": "5" },
        postData: "huge body",
      },
    ];
    const result = summarizeFailures(entries);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      t: 1,
      method: "POST",
      url: "https://x.com/api/save",
      status: 403,
      failure: undefined,
      duration_ms: 234,
    });
    expect(result[0]).not.toHaveProperty("request_headers");
    expect(result[0]).not.toHaveProperty("postData");
  });

  it("preserves the failure field for net errors with no status", () => {
    const entries: any[] = [
      { t: 1, method: "GET", url: "/x", failure: "net::ERR_FOO" },
    ];
    expect(summarizeFailures(entries)[0].failure).toBe("net::ERR_FOO");
  });
});
