import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { navigateTool } from "./tools/navigate.js";
import { snapshotTool } from "./tools/snapshot.js";
import { elementsTool } from "./tools/elements.js";
import { screenshotTool } from "./tools/screenshot.js";
import { clickTool } from "./tools/click.js";
import { typeTool } from "./tools/type.js";
import { scrollTool } from "./tools/scroll.js";
import { selectTool } from "./tools/select.js";
import { waitTool } from "./tools/wait.js";
import { handoffTool } from "./tools/handoff.js";
import { backTool, forwardTool, reloadTool } from "./tools/nav_extra.js";
import { hoverTool } from "./tools/hover.js";
import { pressKeyTool } from "./tools/press_key.js";
import { dragTool } from "./tools/drag.js";
import { saveSession, loadSession, listSessions } from "./tools/session.js";
import { loginTool } from "./tools/login.js";
import { tabsTool, switchTabTool, newTabTool } from "./tools/tabs.js";
import { engine } from "./browser/engine.js";

const server = new McpServer({
  name: "scout",
  version: "0.1.0",
});

// Navigate to URL and return full snapshot
server.tool(
  "scout_navigate",
  "Navigate to a URL. Returns a snapshot with accessibility tree (numbered elements) and screenshot with visual badges.",
  { url: z.string().url().describe("URL to navigate to") },
  async ({ url }) => {
    const result = await navigateTool(url);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { url: result.url, title: result.title, timestamp: result.timestamp, elements: result.elements, markdown: result.markdown },
            null,
            2
          ),
        },
        ...(result.screenshot
          ? [{ type: "image" as const, data: result.screenshot, mimeType: "image/png" as const }]
          : []),
      ],
    };
  }
);

// Snapshot current page
server.tool(
  "scout_snapshot",
  "Take a snapshot of the current page. Returns accessibility tree (numbered elements) and screenshot with visual badges.",
  {},
  async () => {
    const result = await snapshotTool();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { url: result.url, title: result.title, timestamp: result.timestamp, elements: result.elements, markdown: result.markdown },
            null,
            2
          ),
        },
        ...(result.screenshot
          ? [{ type: "image" as const, data: result.screenshot, mimeType: "image/png" as const }]
          : []),
      ],
    };
  }
);

// Get page elements without screenshot
server.tool(
  "scout_elements",
  "Get the current page's accessibility tree (numbered elements) without taking a screenshot. Faster than scout_snapshot.",
  {},
  async () => {
    const result = await elementsTool();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

// Screenshot without badges
server.tool(
  "scout_screenshot",
  "Take a plain screenshot of the current page without element badges.",
  {},
  async () => {
    const result = await screenshotTool();
    return {
      content: [
        { type: "image" as const, data: result.screenshot, mimeType: "image/png" as const },
      ],
    };
  }
);

// Click element by ID
server.tool(
  "scout_click",
  "Click an element by its snapshot ID. Returns healer result describing what changed. If stateChange is 'navigation', element IDs are now stale — call scout_snapshot before using any IDs again.",
  {
    id: z.number().int().positive().describe("Element ID from the last snapshot"),
  },
  async ({ id }) => {
    const result = await clickTool(id);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// Type text into element
server.tool(
  "scout_type",
  "Type text into an input element by its snapshot ID. Uses React-safe keyboard events. If stateChange is 'navigation', call scout_snapshot before using any IDs again.",
  {
    id: z.number().int().positive().describe("Element ID from the last snapshot"),
    text: z.string().describe("Text to type"),
    clear: z.boolean().optional().describe("Clear field before typing (default: false)"),
  },
  async ({ id, text, clear }) => {
    const result = await typeTool(id, text, clear ?? false);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// Scroll the page
server.tool(
  "scout_scroll",
  "Scroll the page in a direction.",
  {
    direction: z
      .enum(["up", "down", "left", "right"])
      .describe("Scroll direction"),
    pixels: z.number().int().positive().optional().describe("Pixels to scroll (default: 400)"),
  },
  async ({ direction, pixels }) => {
    await scrollTool(direction, pixels);
    return { content: [{ type: "text", text: "Scrolled" }] };
  }
);

// Select option from dropdown
server.tool(
  "scout_select",
  "Select an option from a dropdown/select element by its snapshot ID.",
  {
    id: z.number().int().positive().describe("Element ID from the last snapshot"),
    value: z.string().describe("Option value or label to select"),
  },
  async ({ id, value }) => {
    const result = await selectTool(id, value);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// Wait for condition
server.tool(
  "scout_wait",
  "Wait for a page condition.",
  {
    condition: z
      .enum(["navigation", "network_idle", "selector", "timeout"])
      .describe("What to wait for"),
    value: z.string().optional().describe("Selector string or timeout in ms"),
    timeout: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Maximum wait time in ms (default: 30000)"),
  },
  async ({ condition, value, timeout }) => {
    await waitTool(condition, value, timeout);
    return { content: [{ type: "text", text: `Waited for: ${condition}` }] };
  }
);

// Hover element
server.tool(
  "scout_hover",
  "Hover over an element by its snapshot ID.",
  {
    id: z.number().int().positive().describe("Element ID from the last snapshot"),
  },
  async ({ id }) => {
    const result = await hoverTool(id);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// Press key
server.tool(
  "scout_press_key",
  "Press a keyboard key (e.g. Enter, Escape, ArrowDown, Backspace).",
  {
    key: z.string().describe("Key name from Playwright (Enter, Escape, etc.)"),
  },
  async ({ key }) => {
    const result = await pressKeyTool(key);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// Navigation
server.tool(
  "scout_back",
  "Go back in browser history.",
  {},
  async () => {
    const result = await backTool();
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "scout_forward",
  "Go forward in browser history.",
  {},
  async () => {
    const result = await forwardTool();
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "scout_refresh",
  "Refresh the current page.",
  {},
  async () => {
    const result = await reloadTool();
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// Resource blocking
server.tool(
  "scout_block_resources",
  "Block certain resource types to speed up loading (e.g. image, media, stylesheet, font, script).",
  {
    types: z.array(z.string()).describe("Resource types to block"),
  },
  async ({ types }) => {
    await engine.setBlockedResources(types);
    return { content: [{ type: "text", text: `Blocking: ${types.join(", ")}` }] };
  }
);

// Drag and drop
server.tool(
  "scout_drag",
  "Drag one element onto another.",
  {
    sourceId: z.number().int().positive().describe("ID of element to drag"),
    targetId: z.number().int().positive().describe("ID of element to drop onto"),
  },
  async ({ sourceId, targetId }) => {
    const result = await dragTool(sourceId, targetId);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// Session management
server.tool(
  "scout_save_session",
  "Save the current browser session (cookies, localStorage) to a named file.",
  {
    name: z.string().describe("Name of the session"),
  },
  async ({ name }) => {
    const path = await saveSession(name);
    return { content: [{ type: "text", text: `Session saved to ${path}` }] };
  }
);

server.tool(
  "scout_load_session",
  "Load a saved browser session. This will restart the browser context.",
  {
    name: z.string().describe("Name of the session to load"),
  },
  async ({ name }) => {
    await loadSession(name);
    return { content: [{ type: "text", text: `Session ${name} loaded` }] };
  }
);

server.tool(
  "scout_list_sessions",
  "List all saved browser sessions.",
  {},
  async () => {
    const sessions = await listSessions();
    return { content: [{ type: "text", text: JSON.stringify(sessions, null, 2) }] };
  }
);

// High-level platform login
server.tool(
  "scout_login",
  "Log in to a social platform automatically. Handles multi-step flows and unusual activity challenges. Auto-saves the session on success (no need to call scout_save_session). Twitter accepts username; LinkedIn/Instagram/Facebook expect email. Returns {success, url, challenge_type?, error?} — always check success before proceeding.",
  {
    platform: z.enum(["twitter", "linkedin", "instagram", "facebook"]).describe("Platform to log in to"),
    username: z.string().describe("Username (twitter) or email (linkedin, instagram, facebook)"),
    password: z.string().describe("Password"),
  },
  async ({ platform, username, password }) => {
    const result = await loginTool(platform, username, password);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// Console logs
server.tool(
  "scout_console_logs",
  "Get the last 100 browser console logs and errors.",
  {
    clear: z.boolean().optional().describe("Clear logs after reading (default: false)"),
  },
  async ({ clear }) => {
    const logs = engine.getLogs();
    if (clear) engine.clearLogs();
    return { content: [{ type: "text", text: logs.join("\n") || "No logs" }] };
  }
);

// Human-in-the-loop handoff
server.tool(
  "scout_handoff",
  "Show a banner in the live browser asking the user to take a manual action (e.g. solve a CAPTCHA, complete MFA, handle a verification prompt). Blocks until the user clicks Done or the timeout elapses.",
  {
    instruction: z.string().describe("Plain-language instruction shown to the user in the browser"),
    timeout: z.number().int().positive().optional().describe("Max wait in ms (default: 300000 = 5 min)"),
  },
  async ({ instruction, timeout }) => {
    const result = await handoffTool(instruction, timeout);
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2),
      }],
    };
  }
);

// Tab management
server.tool(
  "scout_tabs",
  "List all open browser tabs with their index, URL, title, and which is active.",
  {},
  async () => {
    const tabs = await tabsTool();
    return { content: [{ type: "text", text: JSON.stringify(tabs, null, 2) }] };
  }
);

server.tool(
  "scout_switch_tab",
  "Switch to a browser tab by index (from scout_tabs).",
  {
    index: z.number().int().min(0).describe("Tab index from scout_tabs"),
  },
  async ({ index }) => {
    const tab = await switchTabTool(index);
    return { content: [{ type: "text", text: JSON.stringify(tab, null, 2) }] };
  }
);

server.tool(
  "scout_new_tab",
  "Open a new browser tab, optionally navigating to a URL.",
  {
    url: z.string().url().optional().describe("URL to open in the new tab"),
  },
  async ({ url }) => {
    const tab = await newTabTool(url);
    return { content: [{ type: "text", text: JSON.stringify(tab, null, 2) }] };
  }
);

// Graceful shutdown
process.on("SIGINT", async () => {
  await engine.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await engine.close();
  process.exit(0);
});

// Navigation listener is attached lazily per-page via engine._setupPage

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Scout MCP server running on stdio");
