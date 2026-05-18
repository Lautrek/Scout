import { describe, expect, it, vi } from "vitest";
import {
  isContextClosedError,
  withSelfHeal,
} from "../../src/browser/recovery.js";

describe("isContextClosedError", () => {
  it("recognizes the canonical Playwright phrasing", () => {
    expect(
      isContextClosedError(
        new Error(
          "browserContext.newPage: Target page, context or browser has been closed"
        )
      )
    ).toBe(true);
  });

  it("recognizes 'Target closed'", () => {
    expect(isContextClosedError(new Error("Target closed"))).toBe(true);
  });

  it("recognizes 'Browser has been closed'", () => {
    expect(isContextClosedError(new Error("Browser has been closed"))).toBe(true);
  });

  it("recognizes 'browser has disconnected'", () => {
    expect(
      isContextClosedError(new Error("browser has disconnected unexpectedly"))
    ).toBe(true);
  });

  it("recognizes 'Page has been closed'", () => {
    expect(isContextClosedError(new Error("Page has been closed"))).toBe(true);
  });

  it("recognizes 'BrowserContext is closed'", () => {
    expect(
      isContextClosedError(new Error("BrowserContext is closed"))
    ).toBe(true);
  });

  it("does NOT classify a 404 as context-closed", () => {
    expect(
      isContextClosedError(new Error("Request failed with status 404"))
    ).toBe(false);
  });

  it("does NOT classify a TypeError as context-closed", () => {
    expect(
      isContextClosedError(new TypeError("Cannot read properties of null"))
    ).toBe(false);
  });

  it("handles non-Error values without throwing", () => {
    expect(isContextClosedError("Target closed")).toBe(true);
    expect(isContextClosedError(null)).toBe(false);
    expect(isContextClosedError(undefined)).toBe(false);
    expect(isContextClosedError(123)).toBe(false);
  });
});

describe("withSelfHeal", () => {
  it("returns the value when the operation succeeds first try", async () => {
    const op = vi.fn(async () => 42);
    const beforeRetry = vi.fn();
    const heal = vi.fn(async () => true);

    const result = await withSelfHeal(op, { beforeRetry, heal });

    expect(result).toBe(42);
    expect(op).toHaveBeenCalledTimes(1);
    expect(heal).not.toHaveBeenCalled();
    expect(beforeRetry).not.toHaveBeenCalled();
  });

  it("propagates non-context-closed errors WITHOUT healing", async () => {
    const op = vi.fn(async () => {
      throw new Error("Generic 404");
    });
    const beforeRetry = vi.fn();
    const heal = vi.fn(async () => true);

    await expect(
      withSelfHeal(op, { beforeRetry, heal })
    ).rejects.toThrow("Generic 404");

    expect(op).toHaveBeenCalledTimes(1);
    expect(heal).not.toHaveBeenCalled();
    expect(beforeRetry).not.toHaveBeenCalled();
  });

  it("heals and retries once on a context-closed error, returning the second result", async () => {
    let calls = 0;
    const op = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("Target page, context or browser has been closed");
      }
      return "ok-after-heal";
    });
    const beforeRetry = vi.fn();
    const heal = vi.fn(async () => true);
    const onTrip = vi.fn();

    const result = await withSelfHeal(op, {
      onTrip,
      beforeRetry,
      heal,
    });

    expect(result).toBe("ok-after-heal");
    expect(op).toHaveBeenCalledTimes(2);
    expect(heal).toHaveBeenCalledTimes(1);
    expect(beforeRetry).toHaveBeenCalledTimes(1);
    expect(onTrip).toHaveBeenCalledTimes(1);
  });

  it("invokes beforeRetry AFTER heal so cached state is flushed before the retry call", async () => {
    const order: string[] = [];
    const op = vi.fn(async () => {
      if (order.length === 0) {
        order.push("op-trip");
        throw new Error("Target closed");
      }
      order.push("op-success");
      return "done";
    });
    const beforeRetry = vi.fn(async () => {
      order.push("beforeRetry");
    });
    const heal = vi.fn(async () => {
      order.push("heal");
      return true;
    });

    await withSelfHeal(op, { beforeRetry, heal });

    expect(order).toEqual(["op-trip", "heal", "beforeRetry", "op-success"]);
  });

  it("re-throws the original error when heal returns false", async () => {
    const original = new Error(
      "Target page, context or browser has been closed"
    );
    const op = vi.fn(async () => {
      throw original;
    });
    const beforeRetry = vi.fn();
    const heal = vi.fn(async () => false);

    await expect(
      withSelfHeal(op, { beforeRetry, heal })
    ).rejects.toBe(original);

    expect(op).toHaveBeenCalledTimes(1);
    expect(heal).toHaveBeenCalledTimes(1);
    expect(beforeRetry).not.toHaveBeenCalled();
  });

  it("propagates the second error if the retry also throws", async () => {
    const op = vi.fn(async () => {
      throw new Error("Target closed");
    });
    const heal = vi.fn(async () => true);
    const beforeRetry = vi.fn();

    await expect(
      withSelfHeal(op, { beforeRetry, heal })
    ).rejects.toThrow(/Target closed/);

    expect(op).toHaveBeenCalledTimes(2);
    expect(heal).toHaveBeenCalledTimes(1);
    expect(beforeRetry).toHaveBeenCalledTimes(1);
  });
});
