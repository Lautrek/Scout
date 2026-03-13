import { engine } from "../browser/engine.js";
import { healerWrap } from "../browser/healer.js";
export async function backTool() {
    const page = await engine.getPage();
    return healerWrap(page, async () => {
        await page.goBack();
    });
}
export async function forwardTool() {
    const page = await engine.getPage();
    return healerWrap(page, async () => {
        await page.goForward();
    });
}
export async function reloadTool() {
    const page = await engine.getPage();
    return healerWrap(page, async () => {
        await page.reload();
    });
}
//# sourceMappingURL=nav_extra.js.map