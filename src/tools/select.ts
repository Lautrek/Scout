import { engine } from "../browser/engine.js";
import { getElement } from "../browser/a11y.js";
import { healerWrap } from "../browser/healer.js";
import { HealerResult } from "../types.js";

export async function selectTool(id: number, value: string): Promise<HealerResult> {
  const element = getElement(id);
  if (!element) {
    throw new Error(
      `Element ${id} not found in current snapshot. Call scout_snapshot first.`
    );
  }

  const page = await engine.getPage();

  return healerWrap(page, async () => {
    const locator = page.locator(`[data-scout-id="${id}"]`).first();
    await locator.selectOption(value, { timeout: 5000 });
  });
}
