/**
 * Medium platform adapter.
 *
 * Medium uses a contenteditable editor at /new-story.
 * First line becomes the title, rest becomes the body.
 * Publishing is two-step: "Publish" → settings panel → "Publish now".
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
  editorOpen: 3000,
  afterType: 1500,
  publishPanel: 5000,
  afterPost: 5000,
};

export class MediumAdapter implements PlatformAdapter {
  readonly name = "medium";
  readonly homeUrl = "https://medium.com/";

  async isLoggedIn(page: Page): Promise<boolean> {
    await page.goto(this.homeUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(WAIT.pageLoad);
    const url = page.url();
    if (url.includes("/m/signin") || url.includes("signin")) return false;

    return page.evaluate(() => {
      // Logged-in users see "Write" link, no "Sign in" button
      const writeLink = document.querySelector('a[href*="/new-story"]');
      if (writeLink) return true;
      const btns = document.querySelectorAll("a, button");
      for (const b of btns) {
        const t = (b.textContent || "").trim().toLowerCase();
        if (t === "sign in" || t === "get started") return false;
      }
      return true;
    });
  }

  async getMyPosts(page: Page, limit = 10): Promise<Post[]> {
    // Navigate to user's stories page
    await page.goto("https://medium.com/me/stories/public", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(WAIT.pageLoad);

    return page.evaluate((max: number) => {
      const posts: any[] = [];
      const stories = document.querySelectorAll(
        'article, [data-testid="storyCard"], .yourStories a[href*="/@"]'
      );
      for (const story of Array.from(stories).slice(0, max)) {
        const titleEl = story.querySelector("h2, h3, [data-testid*='title']");
        const linkEl = story.querySelector("a[href*='/@'], a[href*='/p/']");
        posts.push({
          id: linkEl?.getAttribute("href") || "",
          text: titleEl?.textContent?.trim() || "",
          url: linkEl
            ? "https://medium.com" + linkEl.getAttribute("href")
            : "",
          author: "me",
        });
      }
      return posts;
    }, limit);
  }

  async searchPosts(page: Page, query: string, limit = 10): Promise<Post[]> {
    await page.goto(
      `https://medium.com/search?q=${encodeURIComponent(query)}`,
      { waitUntil: "domcontentloaded" }
    );
    await page.waitForTimeout(WAIT.pageLoad);

    return page.evaluate((max: number) => {
      const posts: any[] = [];
      const articles = document.querySelectorAll("article");
      for (const article of Array.from(articles).slice(0, max)) {
        const titleEl = article.querySelector("h2, h3");
        const authorEl = article.querySelector('a[href*="/@"]');
        const linkEl = article.querySelector('a[href*="/p/"]');
        posts.push({
          id: linkEl?.getAttribute("href") || "",
          text: titleEl?.textContent?.trim() || "",
          url: linkEl
            ? "https://medium.com" + linkEl.getAttribute("href")
            : "",
          author: authorEl?.textContent?.trim() || "unknown",
        });
      }
      return posts;
    }, limit);
  }

  async compose(page: Page, text: string): Promise<ComposeResult> {
    try {
      await page.goto("https://medium.com/new-story", {
        waitUntil: "domcontentloaded",
      });
      await page.waitForTimeout(WAIT.editorOpen);

      if (page.url().includes("signin")) {
        return { success: false, error: "Not logged in to Medium" };
      }

      // Split into title (first line) and body (rest)
      const lines = text.split("\n");
      const title = lines[0] || "";
      const body = lines.slice(1).join("\n").trim();

      // Find and type in the title field
      const titleFocused = await page.evaluate(() => {
        const titleEl = document.querySelector(
          'h3[data-testid="storyTitle"], h3[placeholder="Title"], ' +
            'h3[data-contents="true"], p[data-placeholder="Title"]'
        ) as HTMLElement;
        if (titleEl) {
          titleEl.focus();
          titleEl.click();
          return true;
        }
        // Fallback: first contenteditable
        const editor = document.querySelector(
          '[contenteditable="true"]'
        ) as HTMLElement;
        if (editor) {
          editor.focus();
          editor.click();
          return true;
        }
        return false;
      });

      if (!titleFocused) {
        return { success: false, error: "Could not find Medium editor" };
      }

      await page.keyboard.type(title, { delay: 8 });
      await page.keyboard.press("Enter");
      await page.waitForTimeout(300);

      if (body) {
        await page.keyboard.type(body, { delay: 8 });
      }

      await page.waitForTimeout(WAIT.afterType);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  async submitPost(page: Page): Promise<PostResult> {
    try {
      // Step 1: Click "Publish" to open the settings panel
      const publishClicked = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button"));
        for (const b of btns) {
          const t = b.textContent?.trim() || "";
          if (t === "Publish" || t === "Publish story") {
            b.click();
            return true;
          }
        }
        return false;
      });

      if (!publishClicked) {
        return { success: false, error: "Publish button not found" };
      }

      await page.waitForTimeout(WAIT.publishPanel);

      // Step 2: Click "Publish now" in the settings panel
      const confirmed = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button"));
        for (const b of btns) {
          const t = b.textContent?.trim().toLowerCase() || "";
          if (t === "publish now" || t === "publish story") {
            b.click();
            return true;
          }
        }
        return false;
      });

      if (!confirmed) {
        return {
          success: false,
          error: "Publish now button not found in settings panel",
        };
      }

      await page.waitForTimeout(WAIT.afterPost);

      // Check if URL changed from /new-story to published URL
      const url = page.url();
      const success = !url.includes("new-story");
      return {
        success,
        url: success ? url : undefined,
        error: success ? undefined : "Still on new-story page after publish",
      };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  async editPost(_page: Page, _postId: string, _newText: string): Promise<PostResult> {
    // Medium stories can be edited via /p/<id>/edit but the flow is complex
    return { success: false, error: "Medium edit not yet implemented" };
  }

  async deletePost(_page: Page, _postId: string): Promise<boolean> {
    // Medium deletion requires navigating to story settings
    return false;
  }
}
