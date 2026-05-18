import { describe, expect, it, vi } from "vitest";
import { classifyNavigation, navigateImpl } from "../../src/tools/navigate.js";

describe("classifyNavigation", () => {
  it("flags an exact-host-and-path match as not-redirected", () => {
    const r = classifyNavigation(
      "https://x.com/home",
      "https://x.com/home",
      undefined
    );
    expect(r.redirected).toBe(false);
    expect(r.matchesExpectation).toBe(true);
  });

  it("treats trailing-slash differences as identical", () => {
    const r = classifyNavigation(
      "https://www.youtube.com",
      "https://www.youtube.com/",
      undefined
    );
    expect(r.redirected).toBe(false);
  });

  it("ignores query-string and hash differences", () => {
    const r = classifyNavigation(
      "https://x.com/home?foo=1",
      "https://x.com/home#section",
      undefined
    );
    expect(r.redirected).toBe(false);
  });

  it("flags a host change as redirected", () => {
    const r = classifyNavigation(
      "https://studio.youtube.com/",
      "https://www.youtube.com/",
      undefined
    );
    expect(r.redirected).toBe(true);
  });

  it("flags a path change on the same host as redirected", () => {
    const r = classifyNavigation(
      "https://www.youtube.com/account",
      "https://www.youtube.com/signin",
      undefined
    );
    expect(r.redirected).toBe(true);
  });

  it("validates expect_url against the final URL (matches)", () => {
    const r = classifyNavigation(
      "https://studio.youtube.com/channel/UCabc/editing/details",
      "https://studio.youtube.com/channel/UCabc/editing/profile",
      "studio\\.youtube\\.com/channel/UC.+/editing"
    );
    expect(r.matchesExpectation).toBe(true);
  });

  it("validates expect_url against the final URL (does not match)", () => {
    const r = classifyNavigation(
      "https://studio.youtube.com/",
      "https://www.youtube.com/",
      "studio\\.youtube\\.com"
    );
    expect(r.matchesExpectation).toBe(false);
  });

  it("matches expectation case-insensitively", () => {
    const r = classifyNavigation(
      "https://x.com/HOME",
      "https://X.COM/home",
      "x\\.com"
    );
    expect(r.matchesExpectation).toBe(true);
  });

  it("falls back to string-equality for non-URL inputs without throwing", () => {
    expect(() =>
      classifyNavigation("not-a-url", "also-not-a-url", undefined)
    ).not.toThrow();
  });
});

function makePage(opts: { finalUrl: string; title: string }) {
  return {
    goto: vi.fn(async () => {}),
    waitForLoadState: vi.fn(async () => {}),
    url: vi.fn(() => opts.finalUrl),
    title: vi.fn(async () => opts.title),
  } as any;
}

describe("navigateImpl: lean mode", () => {
  it("returns the final URL with redirected=false on a no-op navigation", async () => {
    const page = makePage({
      finalUrl: "https://x.com/home",
      title: "Home / X",
    });
    const result = (await navigateImpl(page, "https://x.com/home")) as any;
    expect(result.url).toBe("https://x.com/home");
    expect(result.requested_url).toBe("https://x.com/home");
    expect(result.redirected).toBe(false);
    expect(result.title).toBe("Home / X");
    expect(typeof result.timestamp).toBe("string");
  });

  it("reports redirected=true and surfaces both URLs when the page redirects", async () => {
    const page = makePage({
      finalUrl: "https://www.youtube.com/",
      title: "YouTube",
    });
    const result = (await navigateImpl(
      page,
      "https://studio.youtube.com/"
    )) as any;
    expect(result.url).toBe("https://www.youtube.com/");
    expect(result.requested_url).toBe("https://studio.youtube.com/");
    expect(result.redirected).toBe(true);
  });

  it("throws when expect_url is set and the final URL doesn't match", async () => {
    const page = makePage({
      finalUrl: "https://www.youtube.com/",
      title: "YouTube",
    });
    await expect(
      navigateImpl(page, "https://studio.youtube.com/", {
        expect_url: "studio\\.youtube\\.com/channel",
      })
    ).rejects.toThrow(/does not match expect_url/);
  });

  it("includes both URLs and the redirect flag in the error message", async () => {
    const page = makePage({
      finalUrl: "https://www.youtube.com/",
      title: "YouTube",
    });
    await expect(
      navigateImpl(page, "https://studio.youtube.com/", {
        expect_url: "studio\\.youtube",
      })
    ).rejects.toThrow(/Requested 'https:\/\/studio\.youtube\.com\/'/);
  });

  it("does not throw when expect_url matches a redirect target", async () => {
    const page = makePage({
      finalUrl:
        "https://studio.youtube.com/channel/UCabc/editing/profile",
      title: "Studio",
    });
    const result = (await navigateImpl(
      page,
      "https://studio.youtube.com/channel/UCabc/editing/details",
      { expect_url: "studio\\.youtube\\.com/channel/UC.+/editing" }
    )) as any;
    expect(result.redirected).toBe(true);
    expect(result.url).toContain("/profile");
  });

  it("forwards timeout_ms to page.goto", async () => {
    const page = makePage({ finalUrl: "https://x.com/", title: "X" });
    await navigateImpl(page, "https://x.com/", { timeout_ms: 5000 });
    expect(page.goto).toHaveBeenCalledWith(
      "https://x.com/",
      expect.objectContaining({ timeout: 5000 })
    );
  });

  it("survives a networkidle timeout without failing the navigation", async () => {
    const page = makePage({ finalUrl: "https://x.com/", title: "X" });
    page.waitForLoadState = vi.fn(async () => {
      throw new Error("Timeout 5000ms exceeded");
    });
    const result = (await navigateImpl(page, "https://x.com/")) as any;
    expect(result.url).toBe("https://x.com/");
  });
});
