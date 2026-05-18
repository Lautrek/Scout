/**
 * Shared deep-walk DOM utilities. Every modern web app — Studio (Polymer),
 * X (custom elements), LinkedIn (lit), Meta (private framework) — buries
 * the elements we want to interact with inside arbitrary shadow roots.
 * Light-DOM querySelectors miss them entirely.
 *
 * The pattern below was reinvented across upload_file, login, type, click,
 * post-publish, etc. This module promotes it to a first-class primitive
 * with two MCP-exposed tools (scout_deep_query, scout_click_when_enabled).
 *
 * Each builder returns a JS *string* sent to page.evaluate / evaluateHandle
 * so we can snapshot-test the script shape without booting a real browser.
 */

import { engine } from "../browser/engine.js";
import type { Page } from "playwright";

/**
 * Predicate signature: a JS expression that takes one Node argument and
 * returns truthy when the node should be collected. Example: `n.tagName ===
 * 'BUTTON' && /publish/i.test(n.innerText || '')`.
 *
 * The expression must be self-contained — no closures over outer scope.
 */
export function buildDeepQueryScript(
  predicateBody: string,
  options: { fields?: string[]; limit?: number } = {}
): string {
  const limit = options.limit ?? 50;
  const fields = options.fields ?? ["tagName", "innerText"];
  // Render a serializer that pulls each field off the node, capping
  // strings to keep payloads bounded.
  const serializer = `(n) => ({
    ${fields
      .map((f) => {
        if (f === "innerText" || f === "textContent" || f === "outerHTML") {
          return `${JSON.stringify(f)}: (n.${f} || '').slice(0, 200)`;
        }
        if (f === "value") {
          return `${JSON.stringify(f)}: n.value`;
        }
        if (f === "checked" || f === "disabled") {
          return `${JSON.stringify(f)}: !!n.${f}`;
        }
        return `${JSON.stringify(f)}: n.${f}`;
      })
      .join(",\n    ")}
  })`;

  return `
((predicateBody) => {
  const predicate = new Function('n', 'return (' + predicateBody + ');');
  const out = [];
  const walk = (n) => {
    if (!n) return;
    try { if (predicate(n)) out.push(n); } catch (_) {}
    n.childNodes && n.childNodes.forEach(walk);
    if (n.shadowRoot) walk(n.shadowRoot);
  };
  walk(document);
  const limit = ${limit};
  const serialize = ${serializer};
  return out.slice(0, limit).map(serialize);
})(${JSON.stringify(predicateBody)})
`;
}

/**
 * JS that finds the first visible, enabled button whose text matches a
 * regex pattern (case-insensitive), and clicks it. Returns the clicked
 * button's text on success, or null when no match is currently clickable.
 *
 * Caller is responsible for polling — wrap with retryUntil for "wait until
 * the button enables" semantics.
 */
export const CLICK_BUTTON_BY_REGEX_JS = `
(pattern) => {
  const out = [];
  const walk = (n) => {
    if (!n) return;
    if (['BUTTON', 'YTCP-BUTTON', 'TP-YT-PAPER-BUTTON', 'PAPER-BUTTON'].includes(n.tagName)) out.push(n);
    if (n.getAttribute && n.getAttribute('role') === 'button') out.push(n);
    n.childNodes && n.childNodes.forEach(walk);
    if (n.shadowRoot) walk(n.shadowRoot);
  };
  walk(document);
  const re = new RegExp(pattern, 'i');
  const visible = (b) =>
    b.offsetParent !== null &&
    !b.disabled &&
    b.getAttribute('aria-disabled') !== 'true';
  const btn = out.find((b) => re.test((b.innerText || '').trim()) && visible(b));
  if (!btn) return null;
  btn.click();
  return (btn.innerText || '').trim().slice(0, 80);
}
`;

export interface ClickWhenEnabledOptions {
  pattern: string;
  timeout_ms?: number;
  poll_ms?: number;
}

export interface ClickWhenEnabledResult {
  clicked: boolean;
  button_text?: string;
  waited_ms: number;
}

/**
 * Pure helper: poll page.evaluate(CLICK_BUTTON_BY_REGEX_JS, pattern) until
 * a match clicks or timeout elapses. Extracted so unit tests can drive it
 * with a mock Page that returns null then a string.
 */
export async function clickWhenEnabledImpl(
  page: Page,
  opts: ClickWhenEnabledOptions
): Promise<ClickWhenEnabledResult> {
  const timeoutMs = opts.timeout_ms ?? 10_000;
  const pollMs = opts.poll_ms ?? 500;
  const start = Date.now();
  const deadline = start + timeoutMs;
  while (Date.now() < deadline) {
    const clicked = (await page.evaluate(
      CLICK_BUTTON_BY_REGEX_JS,
      opts.pattern
    )) as string | null;
    if (clicked) {
      return {
        clicked: true,
        button_text: clicked,
        waited_ms: Date.now() - start,
      };
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return { clicked: false, waited_ms: Date.now() - start };
}

export interface DeepQueryOptions {
  predicate: string;
  fields?: string[];
  limit?: number;
}

export async function deepQueryImpl(
  page: Page,
  opts: DeepQueryOptions
): Promise<unknown[]> {
  const script = buildDeepQueryScript(opts.predicate, {
    fields: opts.fields,
    limit: opts.limit,
  });
  return (await page.evaluate(script)) as unknown[];
}

// ── Tool wrappers (use the active engine page) ──────────────────────

export async function deepQueryTool(opts: DeepQueryOptions): Promise<unknown[]> {
  const page = await engine.getPage();
  return deepQueryImpl(page, opts);
}

export async function clickWhenEnabledTool(
  opts: ClickWhenEnabledOptions
): Promise<ClickWhenEnabledResult> {
  const page = await engine.getPage();
  return clickWhenEnabledImpl(page, opts);
}
