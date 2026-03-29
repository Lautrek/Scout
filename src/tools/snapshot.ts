import { engine } from "../browser/engine.js";
import { extractA11yElements, buildMarkdown, clearElements } from "../browser/a11y.js";
import { captureWithBadges } from "../browser/som.js";
import { SnapshotResult } from "../types.js";

/**
 * Snapshot the current page.
 * lite=false (default): full A11y scan + badges + screenshot (~50-200K tokens)
 * lite=true: elements + markdown only, no screenshot (~5-15K tokens)
 */
export async function snapshotTool(lite = false): Promise<SnapshotResult> {
  const page = await engine.getPage();

  clearElements();

  const elements = await extractA11yElements(page);
  const url = page.url();
  const title = await page.title();
  const markdown = buildMarkdown(url, title, elements);

  // Lite mode: skip the expensive screenshot + badge overlay
  const screenshot = lite ? undefined : await captureWithBadges(page, elements);

  return {
    url,
    title,
    timestamp: new Date().toISOString(),
    elements,
    markdown,
    screenshot,
  };
}
