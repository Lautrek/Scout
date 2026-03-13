import { engine } from "../browser/engine.js";

type ScrollDirection = "up" | "down" | "left" | "right";

export async function scrollTool(
  direction: ScrollDirection,
  pixels = 400
): Promise<void> {
  const page = await engine.getPage();

  const scrollMap: Record<ScrollDirection, [number, number]> = {
    up: [0, -pixels],
    down: [0, pixels],
    left: [-pixels, 0],
    right: [pixels, 0],
  };

  const [x, y] = scrollMap[direction];
  await page.evaluate(
    ({ x, y }: { x: number; y: number }) => window.scrollBy(x, y),
    { x, y }
  );
}
