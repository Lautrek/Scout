import { engine } from "../browser/engine.js";
import { healerWrap } from "../browser/healer.js";
import { HealerResult } from "../types.js";

/** Press a key like "Enter", "Escape", "ArrowDown", etc. */
export async function pressKeyTool(key: string): Promise<HealerResult> {
  const page = await engine.getPage();

  return healerWrap(page, async () => {
    await page.keyboard.press(key);
  });
}
