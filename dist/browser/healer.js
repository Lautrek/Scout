import { INJECT_SCOUT_IDS_SCRIPT } from "./a11y.js";
import crypto from "crypto";
export async function captureState(page) {
    const [url, title, elementCount, bodyContent] = await Promise.all([
        Promise.resolve(page.url()),
        page.title(),
        page.evaluate(() => document.querySelectorAll("*").length),
        page.evaluate(() => document.body?.innerText?.slice(0, 2000) ?? ""),
    ]);
    const bodyHash = crypto.createHash("md5").update(bodyContent).digest("hex");
    return { url, title, elementCount, bodyHash };
}
export async function healerWrap(page, action) {
    const before = await captureState(page);
    await action();
    // Wait briefly for state to settle
    await page.waitForTimeout(500);
    const after = await captureState(page);
    const stateChange = detectChange(before, after);
    // After DOM mutations, re-inject scout IDs so next tool call has fresh targets
    if (stateChange === "dom_change" || stateChange === "modal") {
        await page.evaluate(INJECT_SCOUT_IDS_SCRIPT).catch(() => { });
    }
    return { stateChange, before, after };
}
function detectChange(before, after) {
    if (before.url !== after.url)
        return "navigation";
    if (before.title !== after.title)
        return "navigation";
    // Rough heuristic: large element count change suggests modal or major DOM change
    const countDelta = Math.abs(after.elementCount - before.elementCount);
    if (countDelta > 50)
        return "modal";
    if (before.bodyHash !== after.bodyHash)
        return "dom_change";
    return "none";
}
//# sourceMappingURL=healer.js.map