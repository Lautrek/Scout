import sharp from "sharp";
export async function captureWithBadges(page, elements) {
    // Try CDP-based badge overlay (Chromium only); fall back to plain screenshot for Firefox
    try {
        const client = await page.context().newCDPSession(page);
        try {
            await injectBadges(page, elements, client);
            const screenshotBuffer = await page.screenshot({ type: "png" });
            const compressed = await sharp(screenshotBuffer)
                .resize({ width: 1280, withoutEnlargement: true })
                .png({ compressionLevel: 7 })
                .toBuffer();
            return compressed.toString("base64");
        }
        finally {
            await removeBadges(page);
            await client.detach();
        }
    }
    catch {
        // CDP not available (Firefox) — plain screenshot with DOM-injected badges
        await injectBadgesDom(page, elements);
        try {
            const screenshotBuffer = await page.screenshot({ type: "png" });
            const compressed = await sharp(screenshotBuffer)
                .resize({ width: 1280, withoutEnlargement: true })
                .png({ compressionLevel: 7 })
                .toBuffer();
            return compressed.toString("base64");
        }
        finally {
            await removeBadges(page);
        }
    }
}
async function injectBadges(page, elements, client) {
    // Build badge injection script
    const badgeData = await buildBadgePositions(page, elements, client);
    await page.evaluate((badges) => {
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
async function buildBadgePositions(page, elements, _client) {
    const positions = [];
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
        }
        catch {
            // Element not found or not visible — skip
        }
    }
    return positions;
}
/** Inject badges using only DOM APIs — works in all browsers including Firefox. */
async function injectBadgesDom(page, elements) {
    const badges = elements.map((el) => ({
        id: el.id,
        selector: `[data-scout-id="${el.id}"]`,
    }));
    await page.evaluate((badges) => {
        const container = document.createElement("div");
        container.id = "__scout_badges__";
        container.style.cssText =
            "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;";
        for (const badge of badges) {
            const el = document.querySelector(badge.selector);
            if (!el)
                continue;
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0)
                continue;
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
async function removeBadges(page) {
    try {
        await page.evaluate(() => {
            const container = document.getElementById("__scout_badges__");
            if (container)
                container.remove();
        });
    }
    catch {
        // Page may have navigated — ignore
    }
}
export async function captureScreenshot(page) {
    const screenshotBuffer = await page.screenshot({ type: "png" });
    const compressed = await sharp(screenshotBuffer)
        .resize({ width: 1280, withoutEnlargement: true })
        .png({ compressionLevel: 7 })
        .toBuffer();
    return compressed.toString("base64");
}
//# sourceMappingURL=som.js.map