import { engine } from "../browser/engine.js";
import { extractA11yElements } from "../browser/a11y.js";
import { handoffTool } from "./handoff.js";
import { saveSession } from "./session.js";
const PLATFORM_LOGIN_URLS = {
    twitter: "https://x.com/login",
    linkedin: "https://www.linkedin.com/login",
    instagram: "https://www.instagram.com/accounts/login/",
    facebook: "https://www.facebook.com/login",
};
/**
 * High-level login tool. Navigates to the platform login page and drives
 * the login flow automatically using React-safe keyboard input.
 *
 * Handles:
 * - Standard username/password two-step flows (Twitter/X style)
 * - "Unusual login activity" username confirmation challenges
 * - Unknown challenges: injects a handoff banner for human intervention
 *
 * Supported platforms: twitter, linkedin, instagram, facebook
 */
export async function loginTool(platform, username, password) {
    const loginUrl = PLATFORM_LOGIN_URLS[platform.toLowerCase()];
    if (!loginUrl) {
        return {
            success: false,
            url: "",
            error: `Unsupported platform: ${platform}. Supported: ${Object.keys(PLATFORM_LOGIN_URLS).join(", ")}`,
        };
    }
    const page = await engine.getPage();
    try {
        await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.waitForTimeout(2000);
        for (let step = 0; step < 5; step++) {
            const currentUrl = page.url();
            // Success detection — platform-specific home page indicators
            if (isLoggedIn(platform, currentUrl)) {
                // Auto-save the session so EchoBench can pick it up
                await saveSession(platform).catch(() => { });
                return { success: true, url: currentUrl };
            }
            const elements = await extractA11yElements(page);
            // Detect which step we're on by looking for known input types
            const passwordInput = elements.find((e) => e.role === "textbox" &&
                (e.label?.toLowerCase().includes("password") ||
                    e.placeholder?.toLowerCase().includes("password")));
            const usernameInput = elements.find((e) => e.role === "textbox" &&
                (e.label?.toLowerCase().includes("phone") ||
                    e.label?.toLowerCase().includes("email") ||
                    e.label?.toLowerCase().includes("username") ||
                    e.placeholder?.toLowerCase().includes("phone") ||
                    e.placeholder?.toLowerCase().includes("email") ||
                    e.placeholder?.toLowerCase().includes("username")));
            const nextButton = elements.find((e) => e.role === "button" &&
                (e.label?.toLowerCase() === "next" ||
                    e.label?.toLowerCase() === "continue" ||
                    e.label?.toLowerCase() === "log in" ||
                    e.label?.toLowerCase() === "sign in" ||
                    e.label?.toLowerCase() === "login"));
            if (passwordInput) {
                // Password step
                await focusAndType(page, passwordInput.id, password, true);
                await page.waitForTimeout(500);
                if (nextButton) {
                    await clickById(page, nextButton.id);
                }
                else {
                    await page.keyboard.press("Enter");
                }
                await page.waitForTimeout(3000);
                continue;
            }
            if (usernameInput) {
                // Username/email step (first step or unusual activity challenge)
                await focusAndType(page, usernameInput.id, username, true);
                await page.waitForTimeout(500);
                if (nextButton) {
                    await clickById(page, nextButton.id);
                }
                else {
                    await page.keyboard.press("Enter");
                }
                await page.waitForTimeout(3000);
                continue;
            }
            // No recognized input — check if there's a challenge we can't handle
            const pageText = await page.evaluate(() => document.body.innerText.toLowerCase());
            if (pageText.includes("verify") ||
                pageText.includes("confirm") ||
                pageText.includes("unusual") ||
                pageText.includes("captcha") ||
                pageText.includes("challenge")) {
                // Unknown challenge — hand off to human
                const handoffResult = await handoffTool(`Login challenge on ${platform}. Please complete the verification and click Done when logged in.`, 120_000 // 2 min timeout
                );
                if (handoffResult.completed) {
                    const finalUrl = page.url();
                    const success = isLoggedIn(platform, finalUrl);
                    if (success)
                        await saveSession(platform).catch(() => { });
                    return {
                        success,
                        url: finalUrl,
                        challenge_type: "human_verified",
                    };
                }
                else {
                    return {
                        success: false,
                        url: page.url(),
                        challenge_type: "timeout",
                        error: "Handoff timed out waiting for human to complete challenge",
                    };
                }
            }
            // Nothing recognizable — wait a moment and try again
            await page.waitForTimeout(2000);
        }
        const finalUrl = page.url();
        return {
            success: isLoggedIn(platform, finalUrl),
            url: finalUrl,
            error: isLoggedIn(platform, finalUrl)
                ? undefined
                : "Max steps reached without detecting successful login",
        };
    }
    catch (err) {
        return {
            success: false,
            url: page.url(),
            error: String(err),
        };
    }
}
function isLoggedIn(platform, url) {
    switch (platform.toLowerCase()) {
        case "twitter":
            return url.includes("x.com/home") || url.includes("twitter.com/home");
        case "linkedin":
            return url.includes("linkedin.com/feed") || url.includes("linkedin.com/in/");
        case "instagram":
            return (url.includes("instagram.com") &&
                !url.includes("/login") &&
                !url.includes("/accounts"));
        case "facebook":
            return (url.includes("facebook.com") &&
                !url.includes("/login") &&
                !url.includes("/checkpoint"));
        default:
            return false;
    }
}
async function focusAndType(page, id, text, clear = false) {
    const locator = page.locator(`[data-scout-id="${id}"]`).first();
    try {
        await locator.click({ timeout: 5000 });
    }
    catch {
        await page.keyboard.press("Tab");
        await page.waitForTimeout(100);
    }
    if (clear) {
        await page.keyboard.press("Control+a");
        await page.waitForTimeout(50);
    }
    await page.keyboard.type(text, { delay: 15 });
}
async function clickById(page, id) {
    const locator = page.locator(`[data-scout-id="${id}"]`).first();
    await locator.click({ timeout: 5000 });
}
//# sourceMappingURL=login.js.map