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
 * High-level login tool. Drives the full login flow automatically.
 *
 * Handles automatically:
 * - Standard username/password two-step flows (Twitter/X style)
 * - "Unusual login activity" username confirmation (enter your username/phone/email again)
 * - "Confirm your identity" screens with a fillable input
 *
 * Returns handoff_id (non-blocking) for challenges requiring human:
 * - CAPTCHA images
 * - SMS code sent to phone
 * - Authenticator app TOTP
 * - Email verification code
 *
 * When handoff_id is returned: poll scout_handoff_check(handoff_id) until
 * status is "completed", then call scout_login again or verify with scout_snapshot.
 *
 * Credential formats:
 *   twitter  → username (not email)
 *   linkedin → email
 *   instagram → email
 *   facebook → email
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
        for (let step = 0; step < 8; step++) {
            const currentUrl = page.url();
            // Success detection
            if (isLoggedIn(platform, currentUrl)) {
                await saveSession(platform).catch(() => { });
                return { success: true, url: currentUrl };
            }
            const elements = await extractA11yElements(page);
            const pageText = await page.evaluate(() => document.body.innerText.toLowerCase());
            // --- Detect input fields ---
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
            const anyTextInput = elements.find((e) => e.role === "textbox" && e.enabled);
            const nextButton = elements.find((e) => e.role === "button" &&
                (e.label?.toLowerCase() === "next" ||
                    e.label?.toLowerCase() === "continue" ||
                    e.label?.toLowerCase() === "log in" ||
                    e.label?.toLowerCase() === "sign in" ||
                    e.label?.toLowerCase() === "login" ||
                    e.label?.toLowerCase() === "verify"));
            // --- Password step ---
            if (passwordInput) {
                await focusAndType(page, passwordInput.id, password, true);
                await page.waitForTimeout(500);
                if (nextButton)
                    await clickById(page, nextButton.id);
                else
                    await page.keyboard.press("Enter");
                await page.waitForTimeout(3000);
                continue;
            }
            // --- Username/email step (initial or unusual-activity confirmation) ---
            if (usernameInput) {
                await focusAndType(page, usernameInput.id, username, true);
                await page.waitForTimeout(500);
                if (nextButton)
                    await clickById(page, nextButton.id);
                else
                    await page.keyboard.press("Enter");
                await page.waitForTimeout(3000);
                continue;
            }
            // --- Automatable challenges: generic "confirm your identity" input ---
            // Twitter sometimes shows a plain input with no label/placeholder when asking
            // to re-enter username during an unusual activity check.
            const isConfirmPage = pageText.includes("unusual") ||
                pageText.includes("confirm your identity") ||
                pageText.includes("verify your identity") ||
                pageText.includes("enter your") ||
                pageText.includes("help us confirm");
            if (isConfirmPage && anyTextInput) {
                // Fill with username (the most common ask on this page type)
                await focusAndType(page, anyTextInput.id, username, true);
                await page.waitForTimeout(500);
                if (nextButton)
                    await clickById(page, nextButton.id);
                else
                    await page.keyboard.press("Enter");
                await page.waitForTimeout(3000);
                continue;
            }
            // --- Detect code-input challenges (6-digit boxes, OTP fields) ---
            const codeInput = elements.find((e) => e.role === "textbox" &&
                (e.placeholder?.match(/\d{6}/) ||
                    e.label?.toLowerCase().includes("code") ||
                    e.label?.toLowerCase().includes("otp") ||
                    e.placeholder?.toLowerCase().includes("code")));
            if (codeInput) {
                // Determine what kind of code it is
                const isSms = pageText.includes("text") || pageText.includes("phone") || pageText.includes("sms");
                const isAuthApp = pageText.includes("authenticator") || pageText.includes("totp");
                const isEmail = pageText.includes("email") && !isSms;
                let challengeType = "verification_code";
                let hint = "Enter the verification code";
                if (isSms) {
                    challengeType = "sms_code";
                    hint = "Enter the SMS code sent to your phone";
                }
                else if (isAuthApp) {
                    challengeType = "totp";
                    hint = "Enter the code from your authenticator app";
                }
                else if (isEmail) {
                    challengeType = "email_code";
                    hint = "Enter the code sent to your email";
                }
                const { handoff_id } = await handoffTool(`${hint}, then click Done.`, 120_000);
                return { success: false, url: currentUrl, challenge_type: challengeType, handoff_id };
            }
            // --- CAPTCHA ---
            const hasCaptcha = pageText.includes("captcha") ||
                pageText.includes("i'm not a robot") ||
                elements.some((e) => e.label?.toLowerCase().includes("captcha"));
            if (hasCaptcha) {
                const { handoff_id } = await handoffTool("Please solve the CAPTCHA, then click Done.", 180_000);
                return { success: false, url: currentUrl, challenge_type: "captcha", handoff_id };
            }
            // --- Unknown challenge with no fillable input ---
            const hasAnyChallengeCue = pageText.includes("verify") ||
                pageText.includes("confirm") ||
                pageText.includes("unusual") ||
                pageText.includes("challenge") ||
                pageText.includes("security");
            if (hasAnyChallengeCue && !anyTextInput) {
                const { handoff_id } = await handoffTool(`Login challenge on ${platform}. Please complete the verification and click Done when logged in.`, 120_000);
                return { success: false, url: currentUrl, challenge_type: "unknown_challenge", handoff_id };
            }
            // Nothing recognizable — wait and retry
            await page.waitForTimeout(2000);
        }
        const finalUrl = page.url();
        const success = isLoggedIn(platform, finalUrl);
        return {
            success,
            url: finalUrl,
            error: success ? undefined : "Max steps reached without detecting successful login",
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