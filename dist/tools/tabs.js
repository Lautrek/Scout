import { engine } from "../browser/engine.js";
import { clearElements } from "../browser/a11y.js";
export async function tabsTool() {
    const pages = await engine.getPages();
    const active = await engine.getPage();
    const tabs = await Promise.all(pages.map(async (p, i) => ({
        index: i,
        url: p.url(),
        title: await p.title().catch(() => ""),
        active: p === active,
    })));
    return tabs;
}
export async function switchTabTool(index) {
    const page = await engine.switchPage(index);
    clearElements(); // IDs are stale on tab switch
    return {
        index,
        url: page.url(),
        title: await page.title().catch(() => ""),
        active: true,
    };
}
export async function newTabTool(url) {
    const page = await engine.newPage();
    clearElements();
    if (url) {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        try {
            await page.waitForLoadState("networkidle", { timeout: 5000 });
        }
        catch { }
    }
    const pages = await engine.getPages();
    return {
        index: pages.indexOf(page),
        url: page.url(),
        title: await page.title().catch(() => ""),
        active: true,
    };
}
//# sourceMappingURL=tabs.js.map