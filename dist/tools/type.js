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
        // Try clicking by data-scout-id first; fall back to Tab-focus trick if React cleared attributes
        const locator = page.locator(`[data-scout-id="${id}"]`).first();
        let clicked = false;
        try {
            await locator.click({ timeout: 5000 });
            clicked = true;
        }
        catch {
            // React may have cleared data-scout-id during a re-render; nudge focus to nearest input
            await page.keyboard.press("Tab");
            await page.waitForTimeout(100);
            await page.keyboard.press("Shift+Tab");
            await page.waitForTimeout(100);
        }
        if (clear) {
            await page.keyboard.press("Control+a");
        }
        // page.keyboard.type fires real key events (works with React synthetic inputs)
        await page.keyboard.type(text, { delay: 15 });
        // Verify text landed in the active element
        const landed = await page.evaluate((expected) => {
            const el = document.activeElement;
            const val = el?.value ?? el?.textContent ?? "";
            return val.includes(expected.slice(0, Math.min(expected.length, 5)));
        }, text);
        if (!landed && clicked) {
            // Retry: click by bounding box coordinates as fallback
            try {
                const box = await locator.boundingBox();
                if (box) {
                    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
                    if (clear)
                        await page.keyboard.press("Control+a");
                    await page.keyboard.type(text, { delay: 15 });
                }
            }
            catch {
                // Best effort — proceed anyway
            }
        }
    });
}
//# sourceMappingURL=type.js.map