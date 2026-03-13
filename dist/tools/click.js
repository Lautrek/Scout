import { engine } from "../browser/engine.js";
import { getElement, clearElements } from "../browser/a11y.js";
import { healerWrap } from "../browser/healer.js";
export async function clickTool(id) {
    const element = getElement(id);
    if (!element) {
        throw new Error(`Element ${id} not found in current snapshot. Call scout_snapshot first.`);
    }
    const page = await engine.getPage();
    const result = await healerWrap(page, async () => {
        const locator = page.locator(`[data-scout-id="${id}"]`).first();
        await locator.click({ timeout: 5000 });
    });
    // Clear elements after navigation
    if (result.stateChange === "navigation") {
        clearElements();
    }
    return result;
}
//# sourceMappingURL=click.js.map