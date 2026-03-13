import { engine } from "../browser/engine.js";
import { healerWrap } from "../browser/healer.js";
/** Press a key like "Enter", "Escape", "ArrowDown", etc. */
export async function pressKeyTool(key) {
    const page = await engine.getPage();
    return healerWrap(page, async () => {
        await page.keyboard.press(key);
    });
}
//# sourceMappingURL=press_key.js.map