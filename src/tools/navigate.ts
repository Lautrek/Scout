import { engine } from "../browser/engine.js";
import { extractA11yElements, buildMarkdown, clearElements } from "../browser/a11y.js";
import { captureWithBadges } from "../browser/som.js";
import { SnapshotResult } from "../types.js";

export async function navigateTool(url: string): Promise<SnapshotResult> {
  const page = await engine.getPage();

  clearElements();

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

  // Wait a bit for dynamic content
  try {
    await page.waitForLoadState("networkidle", { timeout: 5000 });
  } catch {
    // Timeout is fine — proceed with what we have
  }

  const elements = await extractA11yElements(page);
  const currentUrl = page.url();
  const title = await page.title();
  const markdown = buildMarkdown(currentUrl, title, elements);
  const screenshot = await captureWithBadges(page, elements);

  return {
    url: currentUrl,
    title,
    timestamp: new Date().toISOString(),
    elements,
    markdown,
    screenshot,
  };
}
