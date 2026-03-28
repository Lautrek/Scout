import { engine } from "../browser/engine.js";

type ScrollDirection = "up" | "down" | "left" | "right";

export async function scrollTool(
  direction: ScrollDirection,
  pixels = 400,
  elementId?: number
): Promise<void> {
  const page = await engine.getPage();

  const scrollMap: Record<ScrollDirection, [number, number]> = {
    up: [0, -pixels],
    down: [0, pixels],
    left: [-pixels, 0],
    right: [pixels, 0],
  };

  const [x, y] = scrollMap[direction];

  if (elementId !== undefined) {
    // Scroll within a specific element (modal, dialog, etc.)
    await page.evaluate(
      ({ id, x, y }: { id: number; x: number; y: number }) => {
        const el = document.querySelector(`[data-scout-id="${id}"]`);
        if (el) {
          el.scrollBy(x, y);
          return;
        }
        // Fallback: find nearest scrollable ancestor of active element
        const active = document.activeElement;
        if (active && active !== document.body) {
          let node: Element | null = active;
          while (node && node !== document.body) {
            if (node.scrollHeight > node.clientHeight) {
              node.scrollBy(x, y);
              return;
            }
            node = node.parentElement;
          }
        }
        window.scrollBy(x, y);
      },
      { id: elementId, x, y }
    );
  } else {
    // Scroll the page
    await page.evaluate(
      ({ x, y }: { x: number; y: number }) => window.scrollBy(x, y),
      { x, y }
    );
  }
}
