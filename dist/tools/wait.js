import { engine } from "../browser/engine.js";
export async function waitTool(condition, value, timeout = 30000) {
    const page = await engine.getPage();
    switch (condition) {
        case "navigation":
            await page.waitForLoadState("domcontentloaded", { timeout });
            break;
        case "network_idle":
            await page.waitForLoadState("networkidle", { timeout });
            break;
        case "selector":
            if (!value)
                throw new Error("selector condition requires a value");
            await page.waitForSelector(value, { timeout });
            break;
        case "timeout":
            await page.waitForTimeout(value ? parseInt(value) : timeout);
            break;
        default:
            throw new Error(`Unknown wait condition: ${condition}`);
    }
}
//# sourceMappingURL=wait.js.map