import { engine } from "../browser/engine.js";
import { getElement } from "../browser/a11y.js";
import { healerWrap } from "../browser/healer.js";
import { HealerResult } from "../types.js";
import { getHumanizer } from "../../shared_lib/agent/humanizer.js";

export async function typeTool(
  id: number,
  text: string,
  clear = false
): Promise<HealerResult> {
  const element = getElement(id);
  if (!element) {
    throw new Error(
      `Element ${id} not found in current snapshot. Call scout_snapshot first.`
    );
  }

  const page = await engine.getPage();
  const human = getHumanizer(page);

  return healerWrap(page, async () => {
    // Try organic click/focus first
    const locator = page.locator(`[data-scout-id="${id}"]`).first();
    let clicked = false;
    try {
      const handle = await locator.elementHandle();
      if (handle) {
        await human.click(handle);
      } else {
        await locator.click({ timeout: 5000 });
      }
      clicked = true;
    } catch {
      // React may have cleared data-scout-id during a re-render; nudge focus to nearest input
      await page.keyboard.press("Tab");
      await human.sleep(50, 150);
      await page.keyboard.press("Shift+Tab");
      await human.sleep(50, 150);
    }

    if (clear) {
      await page.keyboard.press("Control+a");
      await human.sleep(100, 300);
    }

    // Use organic typing
    await human.type(`[data-scout-id="${id}"]`, text);

    // Verify text landed in the active element
    const landed = await page.evaluate((expected: string) => {
      const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement;
      const val = el?.value ?? el?.textContent ?? "";
      return val.includes(expected.slice(0, Math.min(expected.length, 5)));
    }, text);

    if (!landed && clicked) {
      // Retry: click by bounding box coordinates as fallback
      try {
        const box = await locator.boundingBox();
        if (box) {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          if (clear) await page.keyboard.press("Control+a");
          await page.keyboard.type(text, { delay: 15 });
        }
      } catch {
        // Best effort — proceed anyway
      }
    }
  });
}
