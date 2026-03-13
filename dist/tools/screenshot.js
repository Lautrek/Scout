import { engine } from "../browser/engine.js";
import { captureScreenshot } from "../browser/som.js";
export async function screenshotTool() {
    const page = await engine.getPage();
    const screenshot = await captureScreenshot(page);
    return { screenshot };
}
//# sourceMappingURL=screenshot.js.map