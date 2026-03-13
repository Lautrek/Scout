import { engine } from "../browser/engine.js";
import { getElement } from "../browser/a11y.js";
import { healerWrap } from "../browser/healer.js";
export async function dragTool(sourceId, targetId) {
    const source = getElement(sourceId);
    const target = getElement(targetId);
    if (!source || !target) {
        throw new Error(`One or more elements not found: source=${sourceId}, target=${targetId}`);
    }
    const page = await engine.getPage();
    return healerWrap(page, async () => {
        const sourceLoc = page.locator(`[data-scout-id="${sourceId}"]`).first();
        const targetLoc = page.locator(`[data-scout-id="${targetId}"]`).first();
        await sourceLoc.dragTo(targetLoc, { timeout: 10000 });
    });
}
//# sourceMappingURL=drag.js.map