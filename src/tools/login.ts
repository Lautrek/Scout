import { engine } from "../browser/engine.js";
import { extractA11yElements } from "../browser/a11y.js";
import { handoffTool, checkHandoff } from "./handoff.js";
import { saveSession } from "./session.js";
import { getHumanizer } from "../../shared_lib/agent/humanizer.js";

const PLATFORM_LOGIN_URLS: Record<string, string> = {
  twitter: "https://x.com/login",
  linkedin: "https://www.linkedin.com/login",
  instagram: "https://www.instagram.com/accounts/login/",
  facebook: "https://www.facebook.com/login",
  youtube: "https://accounts.google.com/ServiceLogin?service=youtube&continue=https://www.youtube.com/",
};

const PLATFORM_HOME_URLS: Record<string, string> = {
  twitter: "https://x.com/home",
  linkedin: "https://www.linkedin.com/feed/",
  instagram: "https://www.instagram.com/",
  facebook: "https://www.facebook.com/",
  youtube: "https://www.youtube.com/",
};

// SSO orphan hosts — these break our session if we follow them
const SSO_ORPHANS = ["appleid.apple.com", "accounts.google.com/o/oauth2"];

// Domain matchers per platform (used to find the platform's own tab)
const PLATFORM_DOMAINS: Record<string, RegExp> = {
  twitter: /(^|\.)x\.com|(^|\.)twitter\.com/i,
  linkedin: /(^|\.)linkedin\.com/i,
  instagram: /(^|\.)instagram\.com/i,
  facebook: /(^|\.)facebook\.com/i,
  youtube: /(^|\.)youtube\.com|accounts\.google\.com/i,
};

/**
 * Find the existing tab for a platform, or open a new one.
 * Critical for parallel-cockpit safety: never clobber an unrelated tab
 * (e.g. don't take over the X tab to log into Instagram).
 */
async function getOrOpenPlatformPage(platformKey: string, fallbackUrl: string): Promise<any> {
  const domain = PLATFORM_DOMAINS[platformKey];
  if (domain) {
    const pages = await engine.getPages();
    for (const p of pages) {
      try {
        if (domain.test(new URL(p.url()).hostname)) return p;
      } catch {}
    }
  }
  // No existing tab — open a new one
  return await engine.newPage(fallbackUrl);
}

/**
 * DOM-based logged-in check. The cross-platform truth: if a visible
 * password input is on the page, you're being asked to log in.
 */
async function isPageLoggedIn(page: any, _platformKey: string): Promise<boolean> {
  try {
    return await page.evaluate(`(() => {
      const inputs = document.querySelectorAll('input[type="password"], input[name="password"]');
      for (const el of inputs) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const cs = window.getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        return false;
      }
      return true;
    })()`);
  } catch {
    return false;
  }
}

export interface LoginResult {
  success: boolean;
  url: string;
  challenge_type?: string;
  handoff_id?: string;
  via?: "session" | "auto" | "handoff";
  error?: string;
}

/**
 * High-level login. Strategy:
 *   1. Navigate to platform home — if already logged in (persistent profile), return.
 *   2. Try auto-fill once with form-native Enter submission.
 *   3. On any stall, captcha, SSO orphan, or unknown state → promote to human handoff.
 *
 * Goal: 100% session establishment. Auto-fill is best-effort; handoff is the safety net.
 */
export async function loginTool(
  platform: string,
  username: string,
  password: string,
  opts: { handoffTimeoutMs?: number } = {}
): Promise<LoginResult> {
  const platformKey = platform.toLowerCase();
  const loginUrl = PLATFORM_LOGIN_URLS[platformKey];
  const homeUrl = PLATFORM_HOME_URLS[platformKey];
  if (!loginUrl || !homeUrl) {
    return {
      success: false,
      url: "",
      error: `Unsupported platform: ${platform}. Supported: ${Object.keys(PLATFORM_LOGIN_URLS).join(", ")}`,
    };
  }

  // Use the platform's own tab (or open one) — never clobber the active tab.
  const page = await getOrOpenPlatformPage(platformKey, homeUrl);
  const human = getHumanizer(page);
  // Make sure subsequent engine.* calls reference this page if they default to active.
  try {
    await page.bringToFront();
  } catch {}

  // ── 1. Session check ──────────────────────────────────────────────
  try {
    await page.goto(homeUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(2000);
    if (await isPageLoggedIn(page, platformKey)) {
      await saveSession(platformKey).catch(() => {});
      return { success: true, url: page.url(), via: "session" };
    }
  } catch {
    // continue to login flow
  }

  // ── 2. Auto-fill attempt ─────────────────────────────────────────
  try {
    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(2500);

    if (await isPageLoggedIn(page, platformKey)) {
      await saveSession(platformKey).catch(() => {});
      return { success: true, url: page.url(), via: "session" };
    }

    if (await isOnSsoOrphan(page)) {
      return promoteToHandoff(platformKey, homeUrl, "SSO redirect detected", opts);
    }

    for (let step = 0; step < 6; step++) {
      if (await isPageLoggedIn(page, platformKey)) {
        await saveSession(platformKey).catch(() => {});
        return { success: true, url: page.url(), via: "auto" };
      }

      if (await detectChallenge(page)) {
        return promoteToHandoff(platformKey, homeUrl, "Verification challenge detected", opts);
      }

      const elements = await extractA11yElements(page);
      const passwordInput = findPasswordField(elements);
      const usernameInput = findUsernameField(elements, platformKey);

      if (passwordInput) {
        await human.type(`[data-scout-id="${passwordInput.id}"]`, password);
        await human.sleep(400, 900);
        // Form-native Enter — most trusted, least intercepted
        await page.keyboard.press("Enter");
        const navigated = await waitForLoginCommit(page, platformKey, 8000);
        if (!navigated) {
          // Click submit button as fallback (still less reliable but try once)
          const submit = findSubmitButton(elements);
          if (submit) {
            await human.click(`[data-scout-id="${submit.id}"]`).catch(() => {});
            await waitForLoginCommit(page, platformKey, 6000);
          }
        }
        continue;
      }

      if (usernameInput) {
        await human.type(`[data-scout-id="${usernameInput.id}"]`, username);
        await human.sleep(400, 900);
        await page.keyboard.press("Enter");
        await waitForLoginCommit(page, platformKey, 6000);
        continue;
      }

      // No fields found — give the page a moment, then bail to handoff
      await page.waitForTimeout(2000);
    }

    if (await isPageLoggedIn(page, platformKey)) {
      await saveSession(platformKey).catch(() => {});
      return { success: true, url: page.url(), via: "auto" };
    }
  } catch (err) {
    return promoteToHandoff(platformKey, homeUrl, `Auto-fill error: ${String(err)}`, opts);
  }

  // ── 3. Promote to human handoff (the 100% safety net) ────────────
  return promoteToHandoff(platformKey, homeUrl, "Auto-fill stalled", opts);
}

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

function findPasswordField(elements: any[]) {
  return elements.find(
    (e) =>
      (e.role === "textbox" || e.role === "input") &&
      e.visible !== false &&
      (e.label?.toLowerCase().includes("password") ||
        e.placeholder?.toLowerCase().includes("password") ||
        e.type === "password")
  );
}

function findUsernameField(elements: any[], platformKey: string) {
  return elements.find(
    (e) =>
      e.role === "textbox" &&
      e.visible !== false &&
      (e.label?.toLowerCase().match(/phone|email|username/) ||
        e.placeholder?.toLowerCase().match(/phone|email|username/) ||
        (platformKey === "twitter" && !e.label && !e.value))
  );
}

function findSubmitButton(elements: any[]) {
  return elements.find(
    (e) =>
      e.role === "button" &&
      ["next", "continue", "log in", "sign in", "login", "verify"].includes(
        (e.label || "").toLowerCase().trim()
      )
  );
}

async function detectChallenge(page: any): Promise<boolean> {
  try {
    const text = await page.evaluate(() => document.body.innerText.toLowerCase());
    return /unusual activity|verify|captcha|two[- ]?factor|2fa|enter the code|security check/.test(
      text
    );
  } catch {
    return false;
  }
}

async function isOnSsoOrphan(page: any): Promise<boolean> {
  const url = page.url();
  return SSO_ORPHANS.some((host) => url.includes(host));
}

/**
 * Wait for the page to commit the login: either nav to home, or a clear error/challenge.
 * Returns true if anything moved, false if we're stuck on the same login form.
 */
async function waitForLoginCommit(
  page: any,
  platformKey: string,
  timeoutMs: number
): Promise<boolean> {
  const startUrl = page.url();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const cur = page.url();
    if (isLoggedIn(platformKey, cur)) return true;
    if (cur !== startUrl) return true;
    if (await detectChallenge(page)) return true;
    await page.waitForTimeout(400);
  }
  return false;
}

/**
 * Hand the wheel to the human via banner. Polls until completion or timeout,
 * then verifies the resulting session.
 */
async function promoteToHandoff(
  platformKey: string,
  homeUrl: string,
  reason: string,
  opts: { handoffTimeoutMs?: number }
): Promise<LoginResult> {
  const page = await engine.getPage();
  const timeoutMs = opts.handoffTimeoutMs ?? 300_000;

  const { handoff_id } = await handoffTool(
    `Sign in to ${platformKey} (reason: ${reason}). Click Done when you're on the feed.`,
    timeoutMs
  );

  // Block here until human completes or handoff expires.
  const pollDeadline = Date.now() + timeoutMs + 10_000;
  while (Date.now() < pollDeadline) {
    const status = checkHandoff(handoff_id);
    if (status.status === "completed") break;
    if (status.status === "expired" || status.status === "cancelled") {
      return {
        success: false,
        url: page.url(),
        handoff_id,
        via: "handoff",
        error: `Handoff ${status.status} after ${status.elapsed_s}s`,
      };
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  // Verify the session landed
  try {
    if (!(await isPageLoggedIn(page, platformKey))) {
      await page.goto(homeUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(2000);
    }
  } catch {}

  const ok = await isPageLoggedIn(page, platformKey);
  if (ok) await saveSession(platformKey).catch(() => {});
  return {
    success: ok,
    url: page.url(),
    handoff_id,
    via: "handoff",
    error: ok ? undefined : "Handoff completed but session not detected",
  };
}

function isLoggedIn(platformKey: string, url: string): boolean {
  const u = url.toLowerCase();
  // Universal exclusions — a login/auth URL is never "logged in"
  if (/\/login|\/signin|\/sign-in|\/authwall|accounts\.google\.com\/signin/.test(u)) {
    return false;
  }
  switch (platformKey) {
    case "twitter":
      return /(^https?:\/\/(www\.)?(x|twitter)\.com\/(home|i\/|messages|notifications|[^/]+$))/.test(u);
    case "linkedin":
      return u.includes("linkedin.com/feed") || u.includes("linkedin.com/in/");
    case "instagram":
      return (
        /https?:\/\/(www\.)?instagram\.com\/?($|\?|#|direct|explore|reels|[^/]+\/?$)/.test(u) &&
        !u.includes("/accounts/")
      );
    case "facebook":
      return (
        /https?:\/\/(www\.)?facebook\.com\/?($|\?|#|home|profile|groups|marketplace|watch)/.test(u) &&
        !u.includes("/login")
      );
    case "youtube":
      return /https?:\/\/(www\.)?youtube\.com\//.test(u) && !u.includes("accounts.google.com");
    default:
      return false;
  }
}
