import { engine } from "../browser/engine.js";

type WaitCondition = "navigation" | "network_idle" | "selector" | "timeout";

export async function waitTool(
  condition: WaitCondition,
  value?: string,
  timeout = 30000
): Promise<void> {
  const page = await engine.getPage();

  switch (condition) {
    case "navigation":
      await page.waitForLoadState("domcontentloaded", { timeout });
      break;
    case "network_idle":
      await page.waitForLoadState("networkidle", { timeout });
      break;
    case "selector":
      if (!value) throw new Error("selector condition requires a value");
      await page.waitForSelector(value, { timeout });
      break;
    case "timeout":
      await page.waitForTimeout(value ? parseInt(value) : timeout);
      break;
    default:
      throw new Error(`Unknown wait condition: ${condition}`);
  }
}
