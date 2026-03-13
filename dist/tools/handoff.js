import { engine } from "../browser/engine.js";
/**
 * Injects a persistent banner in the live browser asking the user to take a
 * manual action. Returns only when the user clicks "Done" (or a timeout elapses).
 *
 * This is the human-in-the-loop escape hatch: verification prompts, CAPTCHAs,
 * MFA codes, consent dialogs — anything the agent can't automate.
 *
 * Survives page navigations by re-injecting the banner on framenavigated events
 * and polling localStorage as a fallback (persists across soft navigations).
 */
export async function handoffTool(instruction, timeoutMs = 300_000 // 5 min default
) {
    const page = await engine.getPage();
    const start = Date.now();
    async function injectBanner() {
        await page.evaluate((msg) => {
            document.getElementById("__scout_handoff__")?.remove();
            const banner = document.createElement("div");
            banner.id = "__scout_handoff__";
            banner.style.cssText = `
        position: fixed;
        top: 0; left: 0; right: 0;
        background: #1e3a8a;
        color: white;
        padding: 10px 16px;
        z-index: 2147483647;
        font-family: system-ui, sans-serif;
        font-size: 14px;
        display: flex;
        align-items: center;
        gap: 12px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.4);
      `;
            banner.innerHTML = `
        <span style="font-size:18px">🤖</span>
        <span style="flex:1;line-height:1.4">${msg}</span>
        <button
          id="__scout_done_btn__"
          onclick="window.__scout_handoff_done__ = true; localStorage.setItem('__scout_handoff_done__', '1'); this.textContent='✓ Done!'; this.style.background='#16a34a';"
          style="
            background: #22c55e;
            color: white;
            border: none;
            padding: 6px 16px;
            border-radius: 5px;
            cursor: pointer;
            font-weight: bold;
            font-size: 13px;
            white-space: nowrap;
          "
        >Done ✓</button>
      `;
            document.body.prepend(banner);
        }, instruction).catch(() => { });
    }
    // Inject the initial banner
    await injectBanner();
    // Re-inject banner after navigations (Twitter login flow changes pages)
    const navHandler = async () => {
        await injectBanner();
    };
    page.on("framenavigated", navHandler);
    // Poll for completion — checks both window global and localStorage
    let completed = false;
    const deadline = start + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const done = await page.evaluate(() => window.__scout_handoff_done__ === true ||
                localStorage.getItem("__scout_handoff_done__") === "1");
            if (done) {
                completed = true;
                break;
            }
        }
        catch {
            // Page may be navigating — ignore and retry
        }
        await page.waitForTimeout(500);
    }
    // Clean up listener and banner
    page.off("framenavigated", navHandler);
    await page.evaluate(() => {
        document.getElementById("__scout_handoff__")?.remove();
        localStorage.removeItem("__scout_handoff_done__");
        delete window.__scout_handoff_done__;
    }).catch(() => { });
    return { completed, elapsed: Date.now() - start };
}
//# sourceMappingURL=handoff.js.map