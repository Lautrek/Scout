import { engine } from "../browser/engine.js";
import { randomUUID } from "crypto";
// In-process store — survives across tool calls in the same Scout session
const _store = new Map();
/**
 * Inject a banner in the live browser asking the user to take a manual action.
 * Returns IMMEDIATELY with a handoff_id and status "pending".
 *
 * Use scout_handoff_check(handoff_id) to poll until status is "completed".
 * This avoids the ~30s MCP tool call timeout.
 *
 * When to use: CAPTCHAs, SMS/email verification codes, authenticator app prompts,
 * consent dialogs — anything that requires a human and can't be automated.
 *
 * Typical flow:
 *   scout_handoff("Enter the 2FA code then click Done") → {handoff_id: "abc", status: "pending"}
 *   scout_handoff_check("abc") → {status: "pending", elapsed_s: 8}
 *   scout_handoff_check("abc") → {status: "completed", elapsed_s: 21}
 */
export async function handoffTool(instruction, timeoutMs = 300_000) {
    const id = randomUUID();
    const page = await engine.getPage();
    const startedAt = Date.now();
    const state = {
        id,
        instruction,
        startedAt,
        timeoutMs,
        status: "pending",
    };
    _store.set(id, state);
    // Banner injection helper
    async function injectBanner() {
        await page.evaluate(({ msg, handoffId }) => {
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
            onclick="
              window.__scout_handoff_done__ = '${handoffId}';
              localStorage.setItem('__scout_handoff_done__', '${handoffId}');
              this.textContent='✓ Done!';
              this.style.background='#16a34a';
            "
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
        }, { msg: instruction, handoffId: id }).catch(() => { });
    }
    await injectBanner();
    // Re-inject on navigation
    const navHandler = async () => { await injectBanner(); };
    page.on("framenavigated", navHandler);
    state.navHandler = navHandler;
    // Background monitor — polls localStorage, auto-expires, cleans up
    (async () => {
        const deadline = startedAt + timeoutMs;
        while (Date.now() < deadline) {
            const s = _store.get(id);
            if (!s || s.status !== "pending")
                break;
            try {
                const done = await page.evaluate((hid) => window.__scout_handoff_done__ === hid ||
                    localStorage.getItem("__scout_handoff_done__") === hid, id);
                if (done) {
                    s.status = "completed";
                    s.completedAt = Date.now();
                    break;
                }
            }
            catch {
                // Page navigating — ignore
            }
            await new Promise((r) => setTimeout(r, 500));
        }
        const s = _store.get(id);
        if (s && s.status === "pending") {
            s.status = "expired";
        }
        // Clean up
        page.off("framenavigated", navHandler);
        await page.evaluate(() => {
            document.getElementById("__scout_handoff__")?.remove();
            localStorage.removeItem("__scout_handoff_done__");
            delete window.__scout_handoff_done__;
        }).catch(() => { });
    })();
    return {
        handoff_id: id,
        status: "pending",
        message: `Banner injected. Poll with scout_handoff_check("${id}") until status is "completed".`,
    };
}
/**
 * Check the status of a pending handoff.
 * Returns immediately. Poll this every 5-10 seconds after calling scout_handoff.
 */
export function checkHandoff(handoff_id) {
    const s = _store.get(handoff_id);
    if (!s) {
        return {
            status: "expired",
            elapsed_s: 0,
            message: `No handoff found with id "${handoff_id}". It may have expired or never existed.`,
        };
    }
    const elapsed_s = Math.round((Date.now() - s.startedAt) / 1000);
    if (s.status === "completed") {
        _store.delete(handoff_id); // clean up after read
        return {
            status: "completed",
            elapsed_s,
            instruction: s.instruction,
            message: "Human completed the handoff. Proceed with next steps.",
        };
    }
    if (s.status === "expired") {
        _store.delete(handoff_id);
        return {
            status: "expired",
            elapsed_s,
            instruction: s.instruction,
            message: `Handoff timed out after ${elapsed_s}s. Call scout_handoff again to retry.`,
        };
    }
    return {
        status: "pending",
        elapsed_s,
        instruction: s.instruction,
        message: `Still waiting for human. Check again in a few seconds. Timeout in ${Math.round((s.startedAt + s.timeoutMs - Date.now()) / 1000)}s.`,
    };
}
/**
 * Cancel a pending handoff and remove the banner.
 */
export async function cancelHandoff(handoff_id) {
    const s = _store.get(handoff_id);
    if (!s)
        return { cancelled: false };
    s.status = "cancelled";
    _store.delete(handoff_id);
    try {
        const page = await engine.getPage();
        await page.evaluate(() => {
            document.getElementById("__scout_handoff__")?.remove();
            localStorage.removeItem("__scout_handoff_done__");
            delete window.__scout_handoff_done__;
        });
    }
    catch { }
    return { cancelled: true };
}
//# sourceMappingURL=handoff.js.map