import { engine } from "../browser/engine.js";
import { captureScreenshot } from "../browser/som.js";

export async function screenshotTool(): Promise<{ screenshot: string }> {
  const page = await engine.getPage();
  const screenshot = await captureScreenshot(page);
  return { screenshot };
}
