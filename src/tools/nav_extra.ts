import { engine } from "../browser/engine.js";
import { healerWrap } from "../browser/healer.js";
import { HealerResult } from "../types.js";

export async function backTool(): Promise<HealerResult> {
  const page = await engine.getPage();
  return healerWrap(page, async () => {
    await page.goBack();
  });
}

export async function forwardTool(): Promise<HealerResult> {
  const page = await engine.getPage();
  return healerWrap(page, async () => {
    await page.goForward();
  });
}

export async function reloadTool(): Promise<HealerResult> {
  const page = await engine.getPage();
  return healerWrap(page, async () => {
    await page.reload();
  });
}
