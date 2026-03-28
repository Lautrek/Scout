/**
 * X (Twitter) platform adapter.
 *
 * X uses standard DOM (no shadow DOM like LinkedIn).
 * The compose dialog opens via the tweet button or /compose/tweet URL.
 * data-testid attributes are the most reliable selectors.
 */

import { Page } from "playwright";
import {
  PlatformAdapter,
  Post,
  ComposeResult,
  PostResult,
} from "./types.js";

const WAIT = {
  pageLoad: 3000,
  editorOpen: 2000,
  afterType: 1500,
  afterPost: 3000,
};

export class XAdapter implements PlatformAdapter {
  readonly name = "x";
  readonly homeUrl = "https://x.com/home";

  async isLoggedIn(page: Page): Promise<boolean> {
    const url = page.url();
    if (url.includes("x.com/home") || url.includes("twitter.com/home")) {
      return true;
    }
    await page.goto(this.homeUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(WAIT.pageLoad);
    const finalUrl = page.url();
    return (
      !finalUrl.includes("/login") &&
      !finalUrl.includes("/i/flow") &&
      (finalUrl.includes("/home") || finalUrl.includes("x.com"))
    );
  }

  async getMyPosts(page: Page, limit = 10): Promise<Post[]> {
    // Navigate to own profile
    await page.evaluate(() => {
      const profileLink = document.querySelector(
        'a[data-testid="AppTabBar_Profile_Link"]'
      ) as HTMLElement;
      if (profileLink) profileLink.click();
    });
    await page.waitForTimeout(WAIT.pageLoad);

    return page.evaluate((max: number) => {
      const posts: any[] = [];
      const tweets = document.querySelectorAll('article[data-testid="tweet"]');
      for (const tweet of Array.from(tweets).slice(0, max)) {
        const textEl = tweet.querySelector('[data-testid="tweetText"]');
        const timeEl = tweet.querySelector("time");
        const linkEl = tweet.querySelector('a[href*="/status/"]');
        posts.push({
          id: linkEl?.getAttribute("href") || "",
          text: textEl?.textContent?.trim().substring(0, 500) || "",
          url: linkEl ? "https://x.com" + linkEl.getAttribute("href") : "",
          author: "me",
          timestamp: timeEl?.getAttribute("datetime") || "",
        });
      }
      return posts;
    }, limit);
  }

  async searchPosts(page: Page, query: string, limit = 10): Promise<Post[]> {
    await page.goto(
      `https://x.com/search?q=${encodeURIComponent(query)}&f=live`,
      { waitUntil: "domcontentloaded" }
    );
    await page.waitForTimeout(WAIT.pageLoad);

    return page.evaluate((max: number) => {
      const posts: any[] = [];
      const tweets = document.querySelectorAll('article[data-testid="tweet"]');
      for (const tweet of Array.from(tweets).slice(0, max)) {
        const textEl = tweet.querySelector('[data-testid="tweetText"]');
        const authorEl = tweet.querySelector(
          '[data-testid="User-Name"] a'
        );
        const timeEl = tweet.querySelector("time");
        const linkEl = tweet.querySelector('a[href*="/status/"]');
        posts.push({
          id: linkEl?.getAttribute("href") || "",
          text: textEl?.textContent?.trim().substring(0, 500) || "",
          url: linkEl ? "https://x.com" + linkEl.getAttribute("href") : "",
          author: authorEl?.textContent?.trim() || "unknown",
          timestamp: timeEl?.getAttribute("datetime") || "",
        });
      }
      return posts;
    }, limit);
  }

  async compose(page: Page, text: string): Promise<ComposeResult> {
    try {
      // Open compose via URL (most reliable, avoids overlay issues)
      await page.goto("https://x.com/compose/post", {
        waitUntil: "domcontentloaded",
      });
      await page.waitForTimeout(WAIT.editorOpen);

      // Find and focus the tweet editor
      const focused = await page.evaluate(() => {
        const editor = document.querySelector(
          '[data-testid="tweetTextarea_0"], div[role="textbox"][data-testid]'
        ) as HTMLElement;
        if (!editor) return false;
        editor.focus();
        editor.click();
        return true;
      });

      if (!focused) {
        return { success: false, error: "Could not find X compose editor" };
      }

      await page.waitForTimeout(300);
      await page.keyboard.type(text, { delay: 8 });
      await page.waitForTimeout(WAIT.afterType);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  async submitPost(page: Page): Promise<PostResult> {
    try {
      const result = await page.evaluate(() => {
        // X uses data-testid="tweetButton" or "tweetButtonInline"
        const btn =
          document.querySelector('[data-testid="tweetButton"]') ||
          document.querySelector('[data-testid="tweetButtonInline"]');
        if (btn && !(btn as HTMLButtonElement).disabled) {
          (btn as HTMLElement).click();
          return { success: true };
        }
        return { success: false, error: "Tweet button not found or disabled" };
      });

      if (!result.success) return result as PostResult;

      await page.waitForTimeout(WAIT.afterPost);
      return { success: true, url: page.url() };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  async editPost(_page: Page, _postId: string, _newText: string): Promise<PostResult> {
    // X does not support post editing through the web UI in the same way
    return { success: false, error: "X does not support editing posts via automation" };
  }

  async deletePost(page: Page, postId: string): Promise<boolean> {
    const postUrl = postId.startsWith("http") ? postId : `https://x.com${postId}`;
    await page.goto(postUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(WAIT.pageLoad);

    // Click the ... menu on the tweet
    await page.evaluate(() => {
      const btn = document.querySelector(
        '[data-testid="caret"]'
      ) as HTMLElement;
      if (btn) btn.click();
    });
    await page.waitForTimeout(1000);

    // Click Delete
    const deleted = await page.evaluate(() => {
      const items = document.querySelectorAll('[role="menuitem"]');
      for (const item of items) {
        if (item.textContent?.includes("Delete")) {
          (item as HTMLElement).click();
          return true;
        }
      }
      return false;
    });

    if (!deleted) return false;
    await page.waitForTimeout(1000);

    // Confirm
    await page.evaluate(() => {
      const btn = document.querySelector(
        '[data-testid="confirmationSheetConfirm"]'
      ) as HTMLElement;
      if (btn) btn.click();
    });

    await page.waitForTimeout(WAIT.afterPost);
    return true;
  }
}
