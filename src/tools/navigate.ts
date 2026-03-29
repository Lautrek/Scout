import { engine } from "../browser/engine.js";
import { extractA11yElements, buildMarkdown, clearElements } from "../browser/a11y.js";
import { captureWithBadges } from "../browser/som.js";
import { SnapshotResult } from "../types.js";

export interface NavigateResult {
  url: string;
  title: string;
  timestamp: string;
}

/**
 * Navigate to a URL.
 * By default returns only {url, title} (~50 tokens).
 * With snapshot=true, returns full A11y scan + screenshot (~50-200K tokens).
 */
export async function navigateTool(
  url: string,
  snapshot = false
): Promise<NavigateResult | SnapshotResult> {
  const page = await engine.getPage();

  clearElements();

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

  // Wait a bit for dynamic content
  try {
    await page.waitForLoadState("networkidle", { timeout: 5000 });
  } catch {
    // Timeout is fine — proceed with what we have
  }

  const currentUrl = page.url();
  const title = await page.title();

  // Lean mode: just URL + title
  if (!snapshot) {
    return {
      url: currentUrl,
      title,
      timestamp: new Date().toISOString(),
    };
  }

  // Full snapshot mode
  const elements = await extractA11yElements(page);
  const markdown = buildMarkdown(currentUrl, title, elements);
  const screenshotData = await captureWithBadges(page, elements);

  return {
    url: currentUrl,
    title,
    timestamp: new Date().toISOString(),
    elements,
    markdown,
    screenshot: screenshotData,
  };
}
