import { engine } from "../browser/engine.js";
import { getElement } from "../browser/a11y.js";
import { healerWrap } from "../browser/healer.js";
export async function typeTool(id, text, clear = false) {
    const element = getElement(id);
    if (!element) {
        throw new Error(`Element ${id} not found in current snapshot. Call scout_snapshot first.`);
    }
    const page = await engine.getPage();
    return healerWrap(page, async () => {
        const locator = page.locator(`[data-scout-id="${id}"]`).first();
        await locator.click({ timeout: 5000 });
        if (clear) {
            // fill() is fast but skips keyboard events — use selectAll+type for React inputs
            await page.keyboard.press("Control+a");
        }
        // page.keyboard.type fires real key events (works with React synthetic inputs)
        await page.keyboard.type(text, { delay: 15 });
    });
}
//# sourceMappingURL=type.js.map