/**
 * LinkedIn platform adapter.
 *
 * LinkedIn wraps the compose modal in a shadow DOM (#interop-outlet).
 * All editor and button interactions must pierce the shadow root.
 * The ?shareActive=true URL param opens the compose modal directly.
 */

import { Page } from "playwright";
import {
  PlatformAdapter,
  Post,
  ComposeResult,
  PostResult,
} from "./types.js";
import { getHumanizer } from "../../../../lib/agent/humanizer.js";

/** Time to wait for various UI transitions (ms) */
const WAIT = {
  pageLoad: 3000,
  editorOpen: 2000,
  afterType: 2000,
  linkPreview: 5000,
  afterPost: 3000,
};

export class LinkedInAdapter implements PlatformAdapter {
  readonly name = "linkedin";
  readonly homeUrl = "https://www.linkedin.com/feed/";

  async isLoggedIn(page: Page): Promise<boolean> {
    const url = page.url();
    if (url.includes("linkedin.com/feed")) {
      return !url.includes("/login") && !url.includes("/authwall");
    }
    // Navigate to feed and check
    await page.goto(this.homeUrl, { waitUntil: "domcontentloaded" });
    const human = getHumanizer(page);
    await human.sleep(2000, 4000);
    const finalUrl = page.url();
    return (
      finalUrl.includes("/feed") &&
      !finalUrl.includes("/login") &&
      !finalUrl.includes("/authwall")
    );
  }

  async getMyPosts(page: Page, limit = 10): Promise<Post[]> {
    // Navigate to profile activity page
    await page.goto("https://www.linkedin.com/in/me/recent-activity/all/", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(WAIT.pageLoad);

    return page.evaluate((max: number) => {
      const posts: any[] = [];
      const articles = document.querySelectorAll("div.feed-shared-update-v2");
      for (const article of Array.from(articles).slice(0, max)) {
        const textEl = article.querySelector(
          ".feed-shared-update-v2__description, .break-words"
        );
        const linkEl = article.querySelector(
          'a[data-urn], a[href*="/feed/update/"]'
        );
        const reactEl = article.querySelector(
          ".social-details-social-counts__reactions-count"
        );
        if (textEl) {
          posts.push({
            id: linkEl?.getAttribute("href") || "",
            text: textEl.textContent?.trim().substring(0, 500) || "",
            url: linkEl
              ? "https://www.linkedin.com" + linkEl.getAttribute("href")
              : "",
            author: "me",
            reactions: parseInt(reactEl?.textContent || "0") || 0,
          });
        }
      }
      return posts;
    }, limit);
  }

  async searchPosts(page: Page, query: string, limit = 10): Promise<Post[]> {
    const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(WAIT.pageLoad);

    return page.evaluate((max: number) => {
      const posts: any[] = [];
      const results = document.querySelectorAll(
        ".search-results__list .feed-shared-update-v2, .reusable-search__result-container"
      );
      for (const el of Array.from(results).slice(0, max)) {
        const textEl = el.querySelector(".break-words, .update-components-text");
        const authorEl = el.querySelector(
          ".update-components-actor__name, .entity-result__title-text"
        );
        const linkEl = el.querySelector('a[href*="/feed/update/"]');
        if (textEl) {
          posts.push({
            id: linkEl?.getAttribute("href") || "",
            text: textEl.textContent?.trim().substring(0, 500) || "",
            url: linkEl
              ? "https://www.linkedin.com" + linkEl.getAttribute("href")
              : "",
            author: authorEl?.textContent?.trim() || "unknown",
          });
        }
      }
      return posts;
    }, limit);
  }

  async compose(page: Page, text: string): Promise<ComposeResult> {
    try {
      const human = getHumanizer(page);
      
      // Open compose via URL param (most reliable)
      await page.goto(this.homeUrl + "?shareActive=true", {
        waitUntil: "domcontentloaded",
      });
      await human.sleep(2000, 4000);

      // Focus editor in shadow DOM, clear any existing content
      const editorSelector = 'div[contenteditable="true"]';
      const hostSelector = "#interop-outlet";
      
      const focused = await page.evaluate(({hostSel, editSel}) => {
        const host = document.querySelector(hostSel);
        if (!host?.shadowRoot) return false;
        const editor = host.shadowRoot.querySelector(editSel) as HTMLElement;
        if (!editor) return false;
        editor.innerHTML = "";
        editor.focus();
        editor.click();
        return true;
      }, {hostSel: hostSelector, editSel: editorSelector});

      if (!focused) {
        return { success: false, error: "Could not find or focus LinkedIn editor (shadow DOM)" };
      }

      await human.sleep(500, 1000);
      await human.type(hostSelector, text); // Humanizer.type will click the host first, then we type

      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  async submitPost(page: Page): Promise<PostResult> {
    try {
      const human = getHumanizer(page);
      // Wait for link preview to load naturally
      await human.sleep(4000, 6000);

      // Find and click Post button in shadow DOM
      const clicked = await page.evaluate((hostSel) => {
        const host = document.querySelector(hostSel);
        if (!host?.shadowRoot) return false;

        const btns = host.shadowRoot.querySelectorAll("button");
        for (const b of btns) {
          if (b.textContent?.trim() === "Post" && !b.disabled) {
            b.scrollIntoView({ block: "center" });
            b.click();
            return true;
          }
        }
        return false;
      }, "#interop-outlet");

      if (!clicked) {
        return { success: false, error: "Post button not found or disabled" };
      }

      await human.sleep(3000, 5000);
      return { success: true, url: page.url() };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  async editPost(page: Page, postId: string, newText: string): Promise<PostResult> {
    // Navigate to the post
    const postUrl = postId.startsWith("http") ? postId : `https://www.linkedin.com${postId}`;
    await page.goto(postUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(WAIT.pageLoad);

    // Click the ... menu → Edit
    const opened = await page.evaluate(() => {
      // Find the post's control menu
      const btns = document.querySelectorAll("button");
      for (const b of btns) {
        const label = b.getAttribute("aria-label") || "";
        if (label.includes("Open control menu")) {
          b.click();
          return true;
        }
      }
      return false;
    });

    if (!opened) {
      return { success: false, error: "Could not find post menu" };
    }

    await page.waitForTimeout(1000);

    // Click "Edit post"
    const editing = await page.evaluate(() => {
      const items = document.querySelectorAll(
        '[role="menuitem"], [data-control-name]'
      );
      for (const item of items) {
        if (item.textContent?.includes("Edit")) {
          (item as HTMLElement).click();
          return true;
        }
      }
      return false;
    });

    if (!editing) {
      return { success: false, error: "Could not find Edit option" };
    }

    await page.waitForTimeout(WAIT.editorOpen);

    // Clear and retype in the editor (shadow DOM)
    const cleared = await page.evaluate(() => {
      const host = document.querySelector("#interop-outlet");
      if (!host?.shadowRoot) return false;
      const editor = host.shadowRoot.querySelector(
        'div[contenteditable="true"]'
      ) as HTMLElement;
      if (!editor) return false;
      editor.innerHTML = "";
      editor.focus();
      return true;
    });

    if (!cleared) {
      return { success: false, error: "Could not clear editor for editing" };
    }

    // Type new text
    const lines = newText.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]) {
        await page.keyboard.type(lines[i], { delay: 8 });
      }
      if (i < lines.length - 1) {
        await page.keyboard.press("Enter");
      }
    }

    await page.waitForTimeout(WAIT.afterType);

    // Click Save
    const saved = await page.evaluate(() => {
      const host = document.querySelector("#interop-outlet");
      if (!host?.shadowRoot) return false;
      const btns = host.shadowRoot.querySelectorAll("button");
      for (const b of btns) {
        const t = b.textContent?.trim() || "";
        if ((t === "Save" || t === "Done") && !b.disabled) {
          b.click();
          return true;
        }
      }
      return false;
    });

    return saved
      ? { success: true }
      : { success: false, error: "Could not find Save button" };
  }

  async deletePost(page: Page, postId: string): Promise<boolean> {
    const postUrl = postId.startsWith("http") ? postId : `https://www.linkedin.com${postId}`;
    await page.goto(postUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(WAIT.pageLoad);

    // Click ... menu
    await page.evaluate(() => {
      const btns = document.querySelectorAll("button");
      for (const b of btns) {
        if ((b.getAttribute("aria-label") || "").includes("Open control menu")) {
          b.click();
          return;
        }
      }
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

    // Confirm deletion
    await page.evaluate(() => {
      const btns = document.querySelectorAll("button");
      for (const b of btns) {
        if (b.textContent?.trim() === "Delete" && !b.disabled) {
          b.click();
        }
      }
    });

    await page.waitForTimeout(WAIT.afterPost);
    return true;
  }
}
