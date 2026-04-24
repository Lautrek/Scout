import { engine } from "../browser/engine.js";
import { extractA11yElements } from "../browser/a11y.js";
import { handoffTool } from "./handoff.js";
import { saveSession } from "./session.js";
import { getHumanizer } from "../../../../lib/agent/humanizer.js";

const PLATFORM_LOGIN_URLS: Record<string, string> = {
  twitter: "https://x.com/login",
  linkedin: "https://www.linkedin.com/login",
  instagram: "https://www.instagram.com/accounts/login/",
  facebook: "https://www.facebook.com/login",
};

export interface LoginResult {
  success: boolean;
  url: string;
  challenge_type?: string;
  handoff_id?: string;
  error?: string;
}

/**
 * High-level login tool. Drives the full login flow automatically.
 */
export async function loginTool(
  platform: string,
  username: string,
  password: string
): Promise<LoginResult> {
  const loginUrl = PLATFORM_LOGIN_URLS[platform.toLowerCase()];
  if (!loginUrl) {
    return {
      success: false,
      url: "",
      error: `Unsupported platform: ${platform}. Supported: ${Object.keys(PLATFORM_LOGIN_URLS).join(", ")}`,
    };
  }

  const page = await engine.getPage();
  const human = getHumanizer(page);

  try {
    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(3000);

    for (let step = 0; step < 10; step++) {
      const currentUrl = page.url();

      // Success detection
      if (isLoggedIn(platform, currentUrl)) {
        await saveSession(platform).catch(() => {});
        return { success: true, url: currentUrl };
      }

      const elements = await extractA11yElements(page);
      const pageText = await page.evaluate(() => document.body.innerText.toLowerCase());

      // --- Detect input fields ---
      const passwordInput = elements.find(
        (e) =>
          (e.role === "textbox" || e.role === "input") &&
          (e.label?.toLowerCase().includes("password") ||
            e.placeholder?.toLowerCase().includes("password"))
      );

      const usernameInput = elements.find(
        (e) =>
          e.role === "textbox" &&
          (e.label?.toLowerCase().includes("phone") ||
            e.label?.toLowerCase().includes("email") ||
            e.label?.toLowerCase().includes("username") ||
            e.placeholder?.toLowerCase().includes("phone") ||
            e.placeholder?.toLowerCase().includes("email") ||
            e.placeholder?.toLowerCase().includes("username") ||
            // Twitter specific: empty label textbox is usually the username on first step
            (platform.toLowerCase() === "twitter" && !e.label && !e.value))
      );

      const nextButton = elements.find(
        (e) =>
          e.role === "button" &&
          (e.label?.toLowerCase() === "next" ||
            e.label?.toLowerCase() === "continue" ||
            e.label?.toLowerCase() === "log in" ||
            e.label?.toLowerCase() === "sign in" ||
            e.label?.toLowerCase() === "login" ||
            e.label?.toLowerCase() === "verify")
      );

      // --- Password step ---
      if (passwordInput) {
        console.error(`Step ${step}: Typing password...`);
        await human.type(`[data-scout-id="${passwordInput.id}"]`, password);
        await human.sleep(500, 1000);
        if (nextButton) {
            await human.click(`[data-scout-id="${nextButton.id}"]`);
        } else {
            await page.keyboard.press("Enter");
        }
        await page.waitForTimeout(4000);
        continue;
      }

      // --- Username/email step ---
      if (usernameInput) {
        console.error(`Step ${step}: Typing username...`);
        await human.type(`[data-scout-id="${usernameInput.id}"]`, username);
        await human.sleep(500, 1000);
        if (nextButton) {
            await human.click(`[data-scout-id="${nextButton.id}"]`);
        } else {
            await page.keyboard.press("Enter");
        }
        await page.waitForTimeout(4000);
        continue;
      }

      // --- Challenge detection (SMS, Auth App, etc.) ---
      const codeInput = elements.find(
        (e) =>
          e.role === "textbox" &&
          (e.placeholder?.match(/\d{6}/) ||
            e.label?.toLowerCase().includes("code") ||
            e.label?.toLowerCase().includes("otp"))
      );

      if (codeInput || pageText.includes("unusual") || pageText.includes("verify")) {
        const { handoff_id } = await handoffTool(
          `Security challenge detected on ${platform}. Please complete it and click Done.`,
          180_000
        );
        return { success: false, url: currentUrl, handoff_id };
      }

      await page.waitForTimeout(2000);
    }

    return {
      success: isLoggedIn(platform, page.url()),
      url: page.url(),
      error: "Max steps reached",
    };
  } catch (err) {
    return { success: false, url: page.url(), error: String(err) };
  }
}

function isLoggedIn(platform: string, url: string): boolean {
  switch (platform.toLowerCase()) {
    case "twitter":
      return url.includes("x.com/home") || url.includes("twitter.com/home");
    case "linkedin":
      return url.includes("linkedin.com/feed");
    default:
      return false;
  }
}
