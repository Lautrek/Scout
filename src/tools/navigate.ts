import { engine } from "../browser/engine.js";
import { extractA11yElements, buildMarkdown, clearElements } from "../browser/a11y.js";
import { captureWithBadges } from "../browser/som.js";
import { SnapshotResult } from "../types.js";
import type { Page } from "playwright";

export interface NavigateResult {
  url: string;
  requested_url: string;
  redirected: boolean;
  title: string;
  timestamp: string;
}

export interface NavigateOptions {
  /** Snapshot the page (full a11y scan + screenshot) instead of lean URL/title return. */
  snapshot?: boolean;
  /**
   * Optional regex (matched case-insensitively) the *final* URL must match.
   * If set and the post-redirect URL doesn't match, navigateTool throws —
   * preventing agents from operating on a silent-redirect destination.
   */
  expect_url?: string;
  /** Override timeout for the initial page load (default 30000ms). */
  timeout_ms?: number;
}

/**
 * Pure function: classify the navigation outcome. Extracted from navigateTool
 * so we can unit-test the redirect / expect_url logic without booting a browser.
 */
export function classifyNavigation(
  requested: string,
  final: string,
  expect: string | undefined
): { redirected: boolean; matchesExpectation: boolean } {
  const norm = (u: string) => {
    try {
      const url = new URL(u);
      // Compare host + pathname (ignore fragment/search/trailing-slash noise)
      const path = url.pathname.replace(/\/+$/, "") || "/";
      return `${url.host}${path}`;
    } catch {
      return u;
    }
  };
  const redirected = norm(requested) !== norm(final);
  const matchesExpectation = expect
    ? new RegExp(expect, "i").test(final)
    : true;
  return { redirected, matchesExpectation };
}

export async function navigateImpl(
  page: Page,
  url: string,
  opts: NavigateOptions = {}
): Promise<NavigateResult | SnapshotResult> {
  const snapshot = opts.snapshot ?? false;

  clearElements();

  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: opts.timeout_ms ?? 30000,
  });

  try {
    await page.waitForLoadState("networkidle", { timeout: 5000 });
  } catch {
    // networkidle timeout is fine — proceed with what we have
  }

  const finalUrl = page.url();
  const title = await page.title();

  const { redirected, matchesExpectation } = classifyNavigation(
    url,
    finalUrl,
    opts.expect_url
  );

  if (!matchesExpectation) {
    throw new Error(
      `Navigation landed on '${finalUrl}' which does not match expect_url=/${opts.expect_url}/i. ` +
        `Requested '${url}'${redirected ? " (redirected)" : ""}.`
    );
  }

  if (!snapshot) {
    return {
      url: finalUrl,
      requested_url: url,
      redirected,
      title,
      timestamp: new Date().toISOString(),
    };
  }

  const elements = await extractA11yElements(page);
  const markdown = buildMarkdown(finalUrl, title, elements);
  const screenshotData = await captureWithBadges(page, elements);

  return {
    url: finalUrl,
    title,
    timestamp: new Date().toISOString(),
    elements,
    markdown,
    screenshot: screenshotData,
  };
}

/**
 * Navigate to a URL. Returns the *final* (post-redirect) URL alongside
 * the *requested* URL so agents can detect silent redirects (e.g.
 * studio.youtube.com → www.youtube.com when no channel exists).
 *
 * Pass expect_url (regex) to make a redirect-detection a hard error —
 * use this when an agent's next steps depend on landing on a specific page.
 */
export async function navigateTool(
  url: string,
  snapshot = false,
  opts: Omit<NavigateOptions, "snapshot"> = {}
): Promise<NavigateResult | SnapshotResult> {
  const page = await engine.getPage();
  return navigateImpl(page, url, { ...opts, snapshot });
}
