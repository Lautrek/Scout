import { Page, CDPSession } from "playwright";
import { ScoutElement } from "../types.js";

export async function captureWithBadges(
  page: Page,
  elements: ScoutElement[]
): Promise<string> {
  // Try CDP-based badge overlay (Chromium only); fall back to plain screenshot for Firefox
  try {
    const client: CDPSession = await page.context().newCDPSession(page);
    try {
      await injectBadges(page, elements, client);
      return await _captureResized(page);
    } finally {
      await removeBadges(page);
      await client.detach();
    }
  } catch {
    // CDP not available (Firefox) — plain screenshot with DOM-injected badges
    await injectBadgesDom(page, elements);
    try {
      return await _captureResized(page);
    } finally {
      await removeBadges(page);
    }
  }
}

/**
 * Internal helper to capture a screenshot and resize it in-browser using Canvas.
 * This avoids the need for the heavy 'sharp' library.
 */
async function _captureResized(page: Page): Promise<string> {
  // 1. Take full-size JPEG screenshot with moderate quality
  const screenshotBuffer = await page.screenshot({ type: "jpeg", quality: 70 });
  const base64 = screenshotBuffer.toString("base64");

  // 2. Use the browser to resize it via Canvas
  const resizedBase64 = await page.evaluate(async (srcBase64) => {
    return new Promise<string>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const targetWidth = 800;
        const scale = targetWidth / img.width;
        
        // If the image is already small, return it as is
        if (scale >= 1) {
          resolve(srcBase64);
          return;
        }

        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = img.height * scale;
        
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject("Could not get canvas context");
          return;
        }

        // Use high-quality image scaling
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        // Convert to low-quality JPEG for LLM ingestion
        const dataUrl = canvas.toDataURL("image/jpeg", 0.5);
        resolve(dataUrl.split(",")[1]);
      };
      img.onerror = () => reject("Image load error");
      img.src = `data:image/jpeg;base64,${srcBase64}`;
    });
  }, base64);

  return resizedBase64;
}

async function injectBadges(
  page: Page,
  elements: ScoutElement[],
  client: CDPSession
): Promise<void> {
  // Build badge injection script
  const badgeData = await buildBadgePositions(page, elements, client);

  await page.evaluate((badges: Array<{ id: number; x: number; y: number }>) => {
    const container = document.createElement("div");
    container.id = "__scout_badges__";
    container.style.cssText =
      "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;";

    for (const badge of badges) {
      const el = document.createElement("div");
      el.style.cssText = `
        position:fixed;
        left:${badge.x}px;
        top:${badge.y}px;
        background:#2563eb;
        color:white;
        font-size:11px;
        font-weight:bold;
        font-family:monospace;
        padding:1px 4px;
        border-radius:3px;
        line-height:1.4;
        min-width:16px;
        text-align:center;
        pointer-events:none;
        transform:translate(-50%,-50%);
        box-shadow:0 1px 3px rgba(0,0,0,0.4);
      `;
      el.textContent = String(badge.id);
      container.appendChild(el);
    }

    document.body.appendChild(container);
  }, badgeData);
}

async function buildBadgePositions(
  page: Page,
  elements: ScoutElement[],
  _client: CDPSession
): Promise<Array<{ id: number; x: number; y: number }>> {
  const positions: Array<{ id: number; x: number; y: number }> = [];

  for (const el of elements) {
    try {
      const locator = page.locator(`[data-scout-id="${el.id}"]`).first();
      const box = await locator.boundingBox({ timeout: 500 });
      if (box) {
        positions.push({
          id: el.id,
          x: Math.round(box.x + box.width / 2),
          y: Math.round(box.y),
        });
      }
    } catch {
      // Element not found or not visible — skip
    }
  }

  return positions;
}

/** Inject badges using only DOM APIs — works in all browsers including Firefox. */
async function injectBadgesDom(page: Page, elements: ScoutElement[]): Promise<void> {
  const badges: Array<{ id: number; selector: string }> = elements.map((el) => ({
    id: el.id,
    selector: `[data-scout-id="${el.id}"]`,
  }));

  await page.evaluate((badges: Array<{ id: number; selector: string }>) => {
    const container = document.createElement("div");
    container.id = "__scout_badges__";
    container.style.cssText =
      "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;";

    for (const badge of badges) {
      const el = document.querySelector(badge.selector);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;

      const div = document.createElement("div");
      div.style.cssText = `
        position:fixed;
        left:${Math.round(rect.left + rect.width / 2)}px;
        top:${Math.round(rect.top)}px;
        background:#2563eb;
        color:white;
        font-size:11px;
        font-weight:bold;
        font-family:monospace;
        padding:1px 4px;
        border-radius:3px;
        line-height:1.4;
        min-width:16px;
        text-align:center;
        pointer-events:none;
        transform:translate(-50%,-50%);
        box-shadow:0 1px 3px rgba(0,0,0,0.4);
      `;
      div.textContent = String(badge.id);
      container.appendChild(div);
    }
    document.body.appendChild(container);
  }, badges);
}

async function removeBadges(page: Page): Promise<void> {
  try {
    await page.evaluate(() => {
      const container = document.getElementById("__scout_badges__");
      if (container) container.remove();
    });
  } catch {
    // Page may have navigated — ignore
  }
}

export async function captureScreenshot(page: Page): Promise<string> {
  return await _captureResized(page);
}
