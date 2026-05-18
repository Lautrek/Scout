/**
 * Single source of truth for Scout MCP tools.
 *
 * Used by THREE consumers:
 *   1. src/index.ts        — daemon's stdio MCP transport (legacy/direct)
 *   2. src/lcp.ts          — daemon's HTTP /lcp/tools + /lcp/tools/call endpoints
 *   3. src/mcp_proxy.ts    — per-TUI thin proxy (uses schemas only; handlers
 *                            replaced with HTTP forwarding)
 *
 * To add a new tool: add ONE entry below. Daemon stdio, daemon HTTP, and all
 * downstream proxies pick it up automatically.
 */

import { z, ZodRawShape } from "zod";
import { navigateTool } from "./tools/navigate.js";
import { snapshotTool } from "./tools/snapshot.js";
import { elementsTool } from "./tools/elements.js";
import { screenshotTool } from "./tools/screenshot.js";
import { clickTool } from "./tools/click.js";
import { typeTool } from "./tools/type.js";
import { scrollTool } from "./tools/scroll.js";
import { selectTool } from "./tools/select.js";
import { waitTool } from "./tools/wait.js";
import { handoffTool, checkHandoff, cancelHandoff } from "./tools/handoff.js";
import { backTool, forwardTool, reloadTool } from "./tools/nav_extra.js";
import { hoverTool } from "./tools/hover.js";
import { pressKeyTool } from "./tools/press_key.js";
import { dragTool } from "./tools/drag.js";
import { saveSession, loadSession, listSessions } from "./tools/session.js";
import { loginTool } from "./tools/login.js";
import { tabsTool, switchTabTool, newTabTool } from "./tools/tabs.js";
import { uploadFileTool } from "./tools/upload_file.js";
import { deepQueryTool, clickWhenEnabledTool } from "./tools/dom_walk.js";
import { engine } from "./browser/engine.js";
import { getAdapter, listPlatforms } from "./platforms/index.js";

export type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface ToolDef {
  name: string;
  description: string;
  /** Zod shape (pass to McpServer.tool). Empty object {} for no-arg tools. */
  schema: ZodRawShape;
  /** Daemon-side handler. Returns MCP-shaped content. */
  handler: (args: any) => Promise<{ content: McpContent[] }>;
}

const text = (obj: any): McpContent[] => [
  { type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) },
];

export const TOOLS: ToolDef[] = [
  {
    name: "scout_navigate",
    description:
      "Navigate to a URL. Returns {url, requested_url, redirected, title} by default (lean). The url field is the *final* URL after redirects — compare against requested_url to detect silent redirects (e.g. studio.youtube.com → youtube.com when no channel exists). Set expect_url (regex) to make a mismatch a hard error. Set snapshot=true for full accessibility tree + screenshot.",
    schema: {
      url: z.string().url().describe("URL to navigate to"),
      snapshot: z
        .boolean()
        .optional()
        .describe(
          "Include full A11y scan + screenshot (default: false). Only use when you need to discover unknown page structure."
        ),
      expect_url: z
        .string()
        .optional()
        .describe(
          "Regex (case-insensitive) the *final* URL must match after redirects. If set and the post-redirect URL doesn't match, the tool throws — preventing the agent from operating on a silent-redirect destination. Example: 'studio\\\\.youtube\\\\.com/channel/UC.+/editing'."
        ),
      timeout_ms: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Override timeout for the initial page load (default: 30000)"),
    },
    handler: async ({ url, snapshot, expect_url, timeout_ms }) => {
      const result = await navigateTool(url, snapshot ?? false, {
        expect_url,
        timeout_ms,
      });
      if (!snapshot) {
        const lean = result as Awaited<ReturnType<typeof navigateTool>> & {
          requested_url?: string;
          redirected?: boolean;
        };
        return {
          content: text({
            url: lean.url,
            requested_url: lean.requested_url,
            redirected: lean.redirected,
            title: lean.title,
            timestamp: lean.timestamp,
          }),
        };
      }
      const full = result as any;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                url: full.url,
                title: full.title,
                timestamp: full.timestamp,
                elements: full.elements,
                markdown: full.markdown,
              },
              null,
              2
            ),
          },
          ...(full.screenshot
            ? [{ type: "image" as const, data: full.screenshot, mimeType: "image/jpeg" }]
            : []),
        ],
      };
    },
  },
  {
    name: "scout_status",
    description:
      "Get the current status of the Scout browser connection, including active tabs, connection mode, and login presence for social platforms. Login state is detected via DOM signals (visible login form / known logged-in nav elements), not URL — so it correctly handles platforms like Instagram and Facebook that serve different content at the same URL.",
    schema: {},
    handler: async () => {
      const isConnected = engine.isConnected;
      let tabs: any[] = [];
      try {
        tabs = await tabsTool();
      } catch {}

      const platformStatus: Record<string, any> = {
        twitter: { logged_in: false, url: null },
        linkedin: { logged_in: false, url: null },
        instagram: { logged_in: false, url: null },
        facebook: { logged_in: false, url: null },
        youtube: { logged_in: false, url: null },
      };

      // Map URL → platform key
      const platformOf = (u: string): string | null => {
        const url = u.toLowerCase();
        if (url.includes("x.com") || url.includes("twitter.com")) return "twitter";
        if (url.includes("linkedin.com")) return "linkedin";
        if (url.includes("instagram.com")) return "instagram";
        if (url.includes("facebook.com")) return "facebook";
        if (url.includes("youtube.com")) return "youtube";
        return null;
      };

      // DOM-based login detection. The cross-platform truth: a visible
      // password input means you're being asked to log in. This single
      // negative signal is reliable across all five platforms (and
      // correctly catches Instagram/Facebook serving the login form at
      // their root URL while logged-out).
      const detectLoggedIn = async (page: any): Promise<boolean> => {
        try {
          const code = `(() => {
            const inputs = document.querySelectorAll('input[type="password"], input[name="password"]');
            for (const el of inputs) {
              const r = el.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) continue;
              const cs = window.getComputedStyle(el);
              if (cs.display === 'none' || cs.visibility === 'hidden') continue;
              return false; // visible login form → logged out
            }
            return true;
          })()`;
          return await page.evaluate(code);
        } catch {
          return false;
        }
      };

      // Pick the best tab per platform (active tab wins; otherwise first match)
      const bestPageByPlatform = new Map<string, any>();
      try {
        const pages = await engine.getPages();
        for (const page of pages) {
          const p = platformOf(page.url());
          if (!p) continue;
          if (!bestPageByPlatform.has(p)) bestPageByPlatform.set(p, page);
        }
      } catch {}

      for (const [platform, page] of bestPageByPlatform) {
        platformStatus[platform].url = page.url();
        platformStatus[platform].logged_in = await detectLoggedIn(page);
      }

      return {
        content: text({
          status: tabs.length > 0 ? "connected" : "disconnected",
          connected_to_external: isConnected,
          studio_baseline: { port: 9223, platforms: platformStatus },
          tabs: tabs.map((t) => ({ index: t.index, url: t.url, title: t.title, active: t.active })),
          total_tabs: tabs.length,
          timestamp: new Date().toISOString(),
        }),
      };
    },
  },
  {
    name: "scout_snapshot",
    description:
      "Take a snapshot of the current page. Returns accessibility tree (numbered elements). Set lite=true to skip the screenshot (saves ~50K+ tokens). Use full snapshot only when you need to visually see the page.",
    schema: {
      lite: z
        .boolean()
        .optional()
        .describe("Skip screenshot + badge overlay (default: false). Use true when you only need element IDs, not vision."),
    },
    handler: async ({ lite }) => {
      const result = await snapshotTool(lite ?? false);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                url: result.url,
                title: result.title,
                timestamp: result.timestamp,
                elements: result.elements,
                markdown: result.markdown,
              },
              null,
              2
            ),
          },
          ...(result.screenshot
            ? [{ type: "image" as const, data: result.screenshot, mimeType: "image/jpeg" }]
            : []),
        ],
      };
    },
  },
  {
    name: "scout_elements",
    description:
      "Get the current page's accessibility tree (numbered elements) without taking a screenshot. Faster than scout_snapshot.",
    schema: {},
    handler: async () => ({ content: text(await elementsTool()) }),
  },
  {
    name: "scout_screenshot",
    description: "Take a plain screenshot of the current page without element badges.",
    schema: {},
    handler: async () => {
      const result = await screenshotTool();
      return {
        content: [{ type: "image", data: result.screenshot, mimeType: "image/jpeg" }],
      };
    },
  },
  {
    name: "scout_click",
    description:
      "Click an element by its snapshot ID. Returns healer result describing what changed. If stateChange is 'navigation', element IDs are now stale — call scout_snapshot before using any IDs again. If retries > 0 or heal_actions is non-empty, the page was flaky and required recovery — consider re-snapshotting or revising your selector strategy before the next call. Use force=true to bypass overlay elements (shadow DOM, modals) that intercept clicks.",
    schema: {
      id: z.number().int().positive().describe("Element ID from the last snapshot"),
      force: z
        .boolean()
        .optional()
        .describe("Bypass overlay interception (default: false). Use when shadow DOM or modal overlays block normal clicks."),
    },
    handler: async ({ id, force }) => ({
      content: text(await clickTool(id, force ?? false)),
    }),
  },
  {
    name: "scout_type",
    description:
      "Type text into an input element by its snapshot ID. Uses React-safe keyboard events. If stateChange is 'navigation', call scout_snapshot before using any IDs again. If retries > 0 or heal_actions is non-empty, the page was flaky and required recovery — re-snapshot before chaining further actions.",
    schema: {
      id: z.number().int().positive().describe("Element ID from the last snapshot"),
      text: z.string().describe("Text to type"),
      clear: z.boolean().optional().describe("Clear field before typing (default: false)"),
    },
    handler: async ({ id, text: t, clear }) => ({
      content: text(await typeTool(id, t, clear ?? false)),
    }),
  },
  {
    name: "scout_scroll",
    description:
      "Scroll the page or a specific element (modal, dialog) in a direction. Use element_id to scroll within a container instead of the whole page.",
    schema: {
      direction: z.enum(["up", "down", "left", "right"]).describe("Scroll direction"),
      pixels: z.number().int().positive().optional().describe("Pixels to scroll (default: 400)"),
      element_id: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Element ID to scroll within (e.g. a modal or dialog). If omitted, scrolls the page."),
    },
    handler: async ({ direction, pixels, element_id }) => {
      await scrollTool(direction, pixels, element_id);
      return { content: text(element_id ? `Scrolled element ${element_id}` : "Scrolled page") };
    },
  },
  {
    name: "scout_select",
    description:
      "Select an option from a dropdown/select element by its snapshot ID. If retries > 0 or heal_actions is non-empty, the page was flaky and required recovery — re-snapshot before chaining further actions.",
    schema: {
      id: z.number().int().positive().describe("Element ID from the last snapshot"),
      value: z.string().describe("Option value or label to select"),
    },
    handler: async ({ id, value }) => ({ content: text(await selectTool(id, value)) }),
  },
  {
    name: "scout_wait",
    description: "Wait for a page condition.",
    schema: {
      condition: z
        .enum(["navigation", "network_idle", "selector", "timeout"])
        .describe("What to wait for"),
      value: z.string().optional().describe("Selector string or timeout in ms"),
      timeout: z.number().int().positive().optional().describe("Maximum wait time in ms (default: 30000)"),
    },
    handler: async ({ condition, value, timeout }) => {
      await waitTool(condition, value, timeout);
      return { content: text(`Waited for: ${condition}`) };
    },
  },
  {
    name: "scout_hover",
    description: "Hover over an element by its snapshot ID.",
    schema: {
      id: z.number().int().positive().describe("Element ID from the last snapshot"),
    },
    handler: async ({ id }) => ({ content: text(await hoverTool(id)) }),
  },
  {
    name: "scout_press_key",
    description: "Press a keyboard key (e.g. Enter, Escape, ArrowDown, Backspace).",
    schema: {
      key: z.string().describe("Key name from Playwright (Enter, Escape, etc.)"),
    },
    handler: async ({ key }) => ({ content: text(await pressKeyTool(key)) }),
  },
  {
    name: "scout_back",
    description: "Go back in browser history.",
    schema: {},
    handler: async () => ({ content: text(await backTool()) }),
  },
  {
    name: "scout_forward",
    description: "Go forward in browser history.",
    schema: {},
    handler: async () => ({ content: text(await forwardTool()) }),
  },
  {
    name: "scout_refresh",
    description: "Refresh the current page.",
    schema: {},
    handler: async () => ({ content: text(await reloadTool()) }),
  },
  {
    name: "scout_block_resources",
    description:
      "Block certain resource types to speed up loading (e.g. image, media, stylesheet, font, script).",
    schema: { types: z.array(z.string()).describe("Resource types to block") },
    handler: async ({ types }) => {
      await engine.setBlockedResources(types);
      return { content: text(`Blocking: ${types.join(", ")}`) };
    },
  },
  {
    name: "scout_drag",
    description: "Drag one element onto another.",
    schema: {
      sourceId: z.number().int().positive().describe("ID of element to drag"),
      targetId: z.number().int().positive().describe("ID of element to drop onto"),
    },
    handler: async ({ sourceId, targetId }) => ({
      content: text(await dragTool(sourceId, targetId)),
    }),
  },
  {
    name: "scout_save_session",
    description: "Save the current browser session (cookies, localStorage) to a named file.",
    schema: { name: z.string().describe("Name of the session") },
    handler: async ({ name }) => ({ content: text(`Session saved to ${await saveSession(name)}`) }),
  },
  {
    name: "scout_load_session",
    description: "Load a saved browser session. This will restart the browser context.",
    schema: { name: z.string().describe("Name of the session to load") },
    handler: async ({ name }) => {
      await loadSession(name);
      return { content: text(`Session ${name} loaded`) };
    },
  },
  {
    name: "scout_list_sessions",
    description: "List all saved browser sessions.",
    schema: {},
    handler: async () => ({ content: text(await listSessions()) }),
  },
  {
    name: "scout_login",
    description:
      "Log in to a social platform automatically. Handles multi-step flows and unusual activity challenges. Auto-saves the session on success. Returns {success, url, challenge_type?, error?} — always check success before proceeding.",
    schema: {
      platform: z
        .enum(["twitter", "linkedin", "instagram", "facebook", "youtube"])
        .describe("Platform to log in to"),
      username: z.string().describe("Username or email for the platform"),
      password: z.string().describe("Password"),
    },
    handler: async ({ platform, username, password }) => ({
      content: text(await loginTool(platform, username, password)),
    }),
  },
  {
    name: "scout_network_logs",
    description:
      "Return recent HTTP requests captured at the browser layer (CDP Network domain). Survives in-page fetch/XHR overrides because the capture sits below the page. Use to verify whether a click actually fired an API call. Filters: url_includes, method, status_min/max, since_ms (epoch ms — pair with a baseline timestamp before/after an action). Default limit 100. Set include_headers=true to inspect request/response headers (sensitive values redacted unless include_sensitive=true).",
    schema: {
      url_includes: z.string().optional().describe("Substring match (case-insensitive) on the request URL."),
      method: z.string().optional().describe("GET / POST / PUT / DELETE / etc."),
      status_min: z.number().int().optional(),
      status_max: z.number().int().optional(),
      since_ms: z.number().int().optional().describe("Only return entries with t >= this epoch-ms timestamp."),
      limit: z.number().int().positive().optional().describe("Max entries to return (default 100)."),
      include_headers: z.boolean().optional().describe("Include request/response headers in each entry (default false — saves tokens)."),
      include_sensitive: z.boolean().optional().describe("Do NOT redact cookie/authorization/csrf headers (default false). Only set when comparing failed-vs-successful requests for diagnosis."),
    },
    handler: async ({ url_includes, method, status_min, status_max, since_ms, limit, include_headers, include_sensitive }) => ({
      content: text({
        now_ms: Date.now(),
        entries: engine.getNetworkLogs({
          urlIncludes: url_includes,
          method,
          statusMin: status_min,
          statusMax: status_max,
          sinceMs: since_ms,
          limit,
          includeHeaders: include_headers,
          includeSensitive: include_sensitive,
        }),
      }),
    }),
  },
  {
    name: "scout_network_clear",
    description: "Clear the in-memory network log buffer. Returns the new now_ms timestamp so you can pass it as since_ms to bound a future query.",
    schema: {},
    handler: async () => {
      engine.clearNetworkLogs();
      return { content: text({ cleared: true, now_ms: Date.now() }) };
    },
  },
  {
    name: "scout_console_logs",
    description: "Get the last 100 browser console logs and errors.",
    schema: {
      clear: z.boolean().optional().describe("Clear logs after reading (default: false)"),
    },
    handler: async ({ clear }) => {
      const logs = engine.getLogs();
      if (clear) engine.clearLogs();
      return { content: text(logs.join("\n") || "No logs") };
    },
  },
  {
    name: "scout_evaluate",
    description:
      "Execute JavaScript in the current page and return the result. Use for: reading page state, clicking elements blocked by shadow DOM overlays, interacting with Web Components, or any DOM operation not covered by other tools. The code runs in the page context with full DOM access. Returns the serialized result.",
    schema: {
      code: z
        .string()
        .describe(
          "JavaScript code to execute in the page. Must be a valid expression or IIFE. The return value is serialized to JSON."
        ),
    },
    handler: async ({ code }) => {
      const page = await engine.getPage();
      return { content: text(await page.evaluate(code)) };
    },
  },
  {
    name: "scout_handoff",
    description:
      "Inject a banner in the live browser asking the user to take a manual action. Returns IMMEDIATELY with a handoff_id — does NOT block. Poll scout_handoff_check(handoff_id) every 5-10 seconds until status is 'completed'. Use for: CAPTCHAs, SMS codes, authenticator app prompts, email verification.",
    schema: {
      instruction: z.string().describe("Plain-language instruction shown to the user in the browser"),
      timeout: z.number().int().positive().optional().describe("Max wait in ms (default: 300000 = 5 min)"),
    },
    handler: async ({ instruction, timeout }) => ({
      content: text(await handoffTool(instruction, timeout)),
    }),
  },
  {
    name: "scout_handoff_check",
    description:
      "Check whether a pending handoff has been completed by the human. Returns immediately. Call this every 5-10 seconds after scout_handoff until status is 'completed' or 'expired'.",
    schema: { handoff_id: z.string().describe("The handoff_id returned by scout_handoff") },
    handler: async ({ handoff_id }) => ({ content: text(checkHandoff(handoff_id)) }),
  },
  {
    name: "scout_handoff_cancel",
    description: "Cancel a pending handoff and remove the banner from the browser.",
    schema: { handoff_id: z.string().describe("The handoff_id returned by scout_handoff") },
    handler: async ({ handoff_id }) => ({ content: text(await cancelHandoff(handoff_id)) }),
  },
  {
    name: "scout_tabs",
    description: "List all open browser tabs with their index, URL, title, and which is active.",
    schema: {},
    handler: async () => ({ content: text(await tabsTool()) }),
  },
  {
    name: "scout_switch_tab",
    description: "Switch to a browser tab by index (from scout_tabs).",
    schema: { index: z.number().int().min(0).describe("Tab index from scout_tabs") },
    handler: async ({ index }) => ({ content: text(await switchTabTool(index)) }),
  },
  {
    name: "scout_new_tab",
    description: "Open a new browser tab, optionally navigating to a URL.",
    schema: { url: z.string().url().optional().describe("URL to open in the new tab") },
    handler: async ({ url }) => ({ content: text(await newTabTool(url)) }),
  },
  {
    name: "scout_deep_query",
    description:
      "Find DOM nodes anywhere in the page, including shadow roots, by a JavaScript predicate expression. Returns the matched nodes serialized to lightweight objects (default fields: tagName, innerText). Use for: finding elements that querySelectorAll can't reach (Polymer/lit/custom elements). The predicate runs as 'function(n){ return <body>; }' — keep it self-contained.",
    schema: {
      predicate: z
        .string()
        .describe(
          "JS expression body returning truthy when a node matches. The node is bound as `n`. Example: \"n.tagName==='BUTTON' && /publish/i.test(n.innerText||'')\""
        ),
      fields: z
        .array(z.string())
        .optional()
        .describe(
          "Node fields to serialize. Default: ['tagName','innerText']. Other useful fields: id, className, value, checked, disabled, ariaLabel, outerHTML."
        ),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Max nodes to return (default: 50)"),
    },
    handler: async ({ predicate, fields, limit }) => ({
      content: text(await deepQueryTool({ predicate, fields, limit })),
    }),
  },
  {
    name: "scout_click_when_enabled",
    description:
      "Poll for and click the first visible, enabled button whose text matches a regex pattern (case-insensitive). Pierces shadow DOM. Skips buttons that are hidden, disabled, or aria-disabled. Returns when the click lands or the timeout elapses. Use for: confirm dialogs ('Done', 'Save', 'Publish') that take time to enable after async work.",
    schema: {
      pattern: z
        .string()
        .describe(
          "Regex pattern (case-insensitive) matched against button.innerText.trim(). Example: '^(done|save|publish)$' to match exact button labels."
        ),
      timeout_ms: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Max wait for the button to appear AND become enabled (default: 10000)"),
      poll_ms: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Polling interval (default: 500)"),
    },
    handler: async (args) => ({ content: text(await clickWhenEnabledTool(args)) }),
  },
  {
    name: "scout_upload_file",
    description:
      "Upload a file to an <input type=file> element, including inputs nested inside shadow DOM (Studio banner/profile, Meta avatar, X media composer, etc.). Locate the input by selector OR by deep-walked index (default 0) optionally filtered by a regex over the surrounding container's innerText. Optionally clicks a confirm button (e.g. 'Done', 'Save', 'Publish') after upload. Returns matched input metadata and whether the confirm button was clicked.",
    schema: {
      path: z.string().describe("Absolute path to the file to upload"),
      selector: z
        .string()
        .optional()
        .describe(
          "Light-DOM CSS selector. If set, takes precedence over index/parent_match."
        ),
      index: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
          "0-based index into the deep-walked list of file inputs (default: 0)"
        ),
      parent_match: z
        .string()
        .optional()
        .describe(
          "Regex (case-insensitive) matched against the innerText of each file input's nearest section/container. Filters the deep-walked list before applying index. Example: 'banner' to target a banner-upload section."
        ),
      confirm_button: z
        .string()
        .optional()
        .describe(
          "Regex matching the text of a button to click after upload completes (e.g. '^(done|save)$'). The walker pierces shadow DOM and skips disabled buttons."
        ),
      confirm_timeout_ms: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Timeout for confirm button to appear and become enabled (default: 10000)"),
    },
    handler: async (args) => ({ content: text(await uploadFileTool(args)) }),
  },
  {
    name: "scout_post",
    description:
      "Compose and publish a post on a social platform (linkedin, x, medium). Uses the platform adapter pattern — handles shadow DOM, selectors, and compose flows automatically. The browser must be logged into the platform.",
    schema: {
      platform: z.string().describe("Platform: linkedin, x, medium"),
      text: z.string().describe("Post text. For Medium, first line becomes the title."),
      submit: z
        .boolean()
        .optional()
        .describe("Actually submit the post (default: true). Set false for dry run — text is typed but not posted."),
    },
    handler: async ({ platform, text: body, submit }) => {
      const adapter = getAdapter(platform);
      if (!adapter) {
        return { content: text({ error: `Unknown platform: ${platform}`, supported: listPlatforms() }) };
      }
      const page = await engine.getPage();
      if (!(await adapter.isLoggedIn(page))) {
        return {
          content: text({ error: `Not logged in to ${platform}. Log in via your browser first.` }),
        };
      }
      const compose = await adapter.compose(page, body);
      if (!compose.success) return { content: text(compose) };
      if (submit === false) {
        return {
          content: text({ success: true, status: "dry_run", message: "Text composed but not submitted" }),
        };
      }
      return { content: text(await adapter.submitPost(page)) };
    },
  },
  {
    name: "scout_my_posts",
    description: "Get your recent posts on a platform.",
    schema: {
      platform: z.string().describe("Platform: linkedin, x, medium"),
      limit: z.number().int().positive().optional().describe("Max posts to return (default: 10)"),
    },
    handler: async ({ platform, limit }) => {
      const adapter = getAdapter(platform);
      if (!adapter) return { content: text({ error: `Unknown platform: ${platform}` }) };
      return { content: text(await adapter.getMyPosts(await engine.getPage(), limit ?? 10)) };
    },
  },
  {
    name: "scout_delete_post",
    description: "Delete one of your posts on a platform.",
    schema: {
      platform: z.string().describe("Platform: linkedin, x, medium"),
      post_id: z.string().describe("Post ID or URL to delete"),
    },
    handler: async ({ platform, post_id }) => {
      const adapter = getAdapter(platform);
      if (!adapter) return { content: text({ error: `Unknown platform: ${platform}` }) };
      return { content: text({ success: await adapter.deletePost(await engine.getPage(), post_id) }) };
    },
  },
  {
    name: "scout_search_posts",
    description: "Search for posts on a platform.",
    schema: {
      platform: z.string().describe("Platform: linkedin, x, medium"),
      query: z.string().describe("Search query"),
      limit: z.number().int().positive().optional().describe("Max results (default: 10)"),
    },
    handler: async ({ platform, query, limit }) => {
      const adapter = getAdapter(platform);
      if (!adapter) return { content: text({ error: `Unknown platform: ${platform}` }) };
      return {
        content: text(await adapter.searchPosts(await engine.getPage(), query, limit ?? 10)),
      };
    },
  },
];

export const TOOL_BY_NAME: Map<string, ToolDef> = new Map(TOOLS.map((t) => [t.name, t]));

/** Convert a Zod shape to a JSON Schema object (for HTTP discovery). */
export function zodShapeToJsonSchema(shape: ZodRawShape): any {
  const properties: Record<string, any> = {};
  const required: string[] = [];
  for (const [key, zodType] of Object.entries(shape)) {
    properties[key] = zodToJson(zodType as any);
    if (!(zodType as any).isOptional?.()) required.push(key);
  }
  const schema: any = { type: "object", properties };
  if (required.length) schema.required = required;
  return schema;
}

function zodToJson(z: any): any {
  // Best-effort, no external deps. Covers shapes used in this registry.
  const def = z?._def;
  if (!def) return {};
  switch (def.typeName) {
    case "ZodOptional":
      return zodToJson(def.innerType);
    case "ZodDefault":
      return zodToJson(def.innerType);
    case "ZodString":
      return { type: "string", description: def.description };
    case "ZodNumber":
      return { type: "number", description: def.description };
    case "ZodBoolean":
      return { type: "boolean", description: def.description };
    case "ZodArray":
      return { type: "array", items: zodToJson(def.type), description: def.description };
    case "ZodEnum":
      return { type: "string", enum: def.values, description: def.description };
    case "ZodObject": {
      const props: Record<string, any> = {};
      for (const [k, v] of Object.entries(def.shape())) props[k] = zodToJson(v);
      return { type: "object", properties: props };
    }
    default:
      return { description: def.description };
  }
}
