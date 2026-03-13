import { engine } from "../browser/engine.js";
export async function scrollTool(direction, pixels = 400) {
    const page = await engine.getPage();
    const scrollMap = {
        up: [0, -pixels],
        down: [0, pixels],
        left: [-pixels, 0],
        right: [pixels, 0],
    };
    const [x, y] = scrollMap[direction];
    await page.evaluate(({ x, y }) => window.scrollBy(x, y), { x, y });
}
//# sourceMappingURL=scroll.js.map