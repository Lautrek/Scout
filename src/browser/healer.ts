import { Page } from "playwright";
import { HealerState, HealerResult, StateChange } from "../types.js";
import { INJECT_SCOUT_IDS_SCRIPT } from "./a11y.js";
import crypto from "crypto";

export async function captureState(page: Page): Promise<HealerState> {
  const [url, title, elementCount, bodyContent] = await Promise.all([
    Promise.resolve(page.url()),
    page.title(),
    page.evaluate(() => document.querySelectorAll("*").length),
    page.evaluate(() => document.body?.innerText?.slice(0, 2000) ?? ""),
  ]);

  const bodyHash = crypto.createHash("md5").update(bodyContent).digest("hex");

  return { url, title, elementCount, bodyHash };
}

const MAX_HEAL_RETRIES = parseInt(process.env.SCOUT_HEAL_RETRIES ?? "2");
const HEAL_RETRY_BACKOFF_MS = parseInt(process.env.SCOUT_HEAL_BACKOFF_MS ?? "300");

export async function healerWrap(
  page: Page,
  action: () => Promise<void>
): Promise<HealerResult> {
  const before = await captureState(page);
  const heal_actions: string[] = [];
  let retries = 0;
  let lastError: unknown = null;

  // Bounded retry: on action failure, re-inject scout IDs and back off briefly.
  // Each retry pass is recorded so the in-band model can see when a tool call
  // was flaky vs first-try clean.
  while (true) {
    try {
      await action();
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
      if (retries >= MAX_HEAL_RETRIES) break;
      retries += 1;
      await page.evaluate(INJECT_SCOUT_IDS_SCRIPT).catch(() => {});
      heal_actions.push("retry_dom_reinject");
      await page.waitForTimeout(HEAL_RETRY_BACKOFF_MS);
    }
  }

  if (lastError) {
    const afterFail = await captureState(page).catch(() => before);
    const stateChangeOnFail = detectChange(before, afterFail);
    const baseMsg =
      lastError instanceof Error ? lastError.message : String(lastError);
    const enriched: Error & { healer?: HealerResult } = new Error(
      `${baseMsg} (retries=${retries}, heal_actions=[${heal_actions.join(",")}])`
    );
    enriched.healer = {
      stateChange: stateChangeOnFail,
      before,
      after: afterFail,
      recovered: false,
      retries,
      heal_actions,
    };
    throw enriched;
  }

  await page.waitForTimeout(500);

  const after = await captureState(page);
  const stateChange = detectChange(before, after);

  if (stateChange === "dom_change" || stateChange === "modal") {
    await page.evaluate(INJECT_SCOUT_IDS_SCRIPT).catch(() => {});
    heal_actions.push("reinject_ids");
  }

  return {
    stateChange,
    before,
    after,
    recovered: retries > 0 || heal_actions.length > 0,
    retries,
    heal_actions,
  };
}

function detectChange(before: HealerState, after: HealerState): StateChange {
  if (before.url !== after.url) return "navigation";

  if (before.title !== after.title) return "navigation";

  // Rough heuristic: large element count change suggests modal or major DOM change
  const countDelta = Math.abs(after.elementCount - before.elementCount);
  if (countDelta > 50) return "modal";

  if (before.bodyHash !== after.bodyHash) return "dom_change";

  return "none";
}
