import { engine } from "../browser/engine.js";
import { extractA11yElements, buildMarkdown, clearElements } from "../browser/a11y.js";
import { captureWithBadges } from "../browser/som.js";
export async function snapshotTool() {
    const page = await engine.getPage();
    clearElements();
    const elements = await extractA11yElements(page);
    const url = page.url();
    const title = await page.title();
    const markdown = buildMarkdown(url, title, elements);
    const screenshot = await captureWithBadges(page, elements);
    return {
        url,
        title,
        timestamp: new Date().toISOString(),
        elements,
        markdown,
        screenshot,
    };
}
//# sourceMappingURL=snapshot.js.map