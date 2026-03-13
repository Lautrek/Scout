import { engine } from "../browser/engine.js";

/**
 * Injects a persistent banner in the live browser asking the user to take a
 * manual action. Returns only when the user clicks "Done" (or a timeout elapses).
 *
 * This is the human-in-the-loop escape hatch: verification prompts, CAPTCHAs,
 * MFA codes, consent dialogs — anything the agent can't automate.
 */
export async function handoffTool(
  instruction: string,
  timeoutMs = 300_000 // 5 min default
): Promise<{ completed: boolean; elapsed: number }> {
  const page = await engine.getPage();
  const start = Date.now();

  // Inject the handoff overlay
  await page.evaluate((msg: string) => {
    // Remove any existing handoff banner
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
        onclick="window.__scout_handoff_done__ = true; this.textContent='✓ Done!'; this.style.background='#16a34a';"
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
  }, instruction);

  // Wait for a human to click the Done button (polls flag set by onclick handler)
  let completed = false;
  try {
    await page.waitForFunction(
      () => (window as any).__scout_handoff_done__ === true,
      { timeout: timeoutMs, polling: 500 }
    );
    completed = true;
  } catch {
    // Timed out
  }

  // Remove the banner
  await page.evaluate(() => {
    document.getElementById("__scout_handoff__")?.remove();
  }).catch(() => {});

  return { completed, elapsed: Date.now() - start };
}
