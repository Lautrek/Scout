/**
 * LCP — Lautrek Cockpit Protocol HTTP server.
 *
 * Hosted by the Scout daemon. Used by:
 *   - mcp_proxy.ts (per-TUI thin shim)        → POST /lcp/tools/call, GET /lcp/tools
 *   - EchoBench (Python)                       → POST /lcp/dispatch (legacy operations)
 *   - any other client speaking HTTP
 *
 * Port discovery: writes the bound port to ~/.scout/lcp.port on listen, so
 * downstream clients can find the daemon without hardcoding.
 */

import express from "express";
import cors from "cors";
import { Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { promises as fs, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { navigateTool } from "./tools/navigate.js";
import { snapshotTool } from "./tools/snapshot.js";
import { clickTool } from "./tools/click.js";
import { typeTool } from "./tools/type.js";
import { scrollTool } from "./tools/scroll.js";
import { selectTool } from "./tools/select.js";
import { waitTool } from "./tools/wait.js";
import { pressKeyTool } from "./tools/press_key.js";
import { hoverTool } from "./tools/hover.js";
import { newTabTool, switchTabTool } from "./tools/tabs.js";
import { engine, Condition } from "./browser/engine.js";
import {
  pickRecentFailures,
  summarizeFailures,
} from "./browser/recent_failures.js";
import { TOOLS, TOOL_BY_NAME, zodShapeToJsonSchema } from "./tool_registry.js";
import { z } from "zod";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const startTime = Date.now();
const LCP_SECRET = process.env.SCOUT_LCP_SECRET ?? "";

// Auth middleware — only enforced when SCOUT_LCP_SECRET is set
function requireSecret(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (!LCP_SECRET) return next();
  const auth =
    (req.headers["x-scout-secret"] as string) ??
    (req.headers.authorization?.replace("Bearer ", "") || "");
  if (auth !== LCP_SECRET) {
    res.status(401).json({ error: "Unauthorized — set X-Scout-Secret header" });
    return;
  }
  next();
}

app.use("/lcp/dispatch", requireSecret);
app.use("/lcp/forge", requireSecret);
app.use("/lcp/tools/call", requireSecret);

// ─── 1. Health ────────────────────────────────────────────────────────────
app.get("/lcp/health", (req, res) => {
  res.json({
    status: "ok",
    service: "scout",
    uptime_s: (Date.now() - startTime) / 1000,
    tool_count: TOOLS.length,
  });
});

// ─── 2. MCP-style tool discovery + invocation (parallel cockpit) ──────────
app.get("/lcp/tools", (req, res) => {
  res.json({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodShapeToJsonSchema(t.schema),
    })),
  });
});

app.post("/lcp/tools/call", async (req, res) => {
  const { name, arguments: args } = req.body ?? {};
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) {
    return res.status(404).json({ error: `Unknown tool: ${name}` });
  }
  try {
    // Validate via the tool's zod shape
    const parsed = z.object(tool.schema).parse(args ?? {});
    const result = await tool.handler(parsed);
    res.json(result);
  } catch (err: any) {
    console.error(`LCP tool call error [${name}]:`, err);
    // Auto-attach recent network failures so callers see 4xx/5xx /
    // request-failed entries that may explain the tool error. Skip when
    // the user has explicitly opted out (SCOUT_AUTOPULL_FAILURES=false).
    let recent_failures: any[] | undefined;
    if (process.env.SCOUT_AUTOPULL_FAILURES !== "false") {
      try {
        const all = engine.getNetworkLogs({ limit: 500 });
        const picked = pickRecentFailures(all);
        if (picked.length > 0) recent_failures = summarizeFailures(picked);
      } catch {
        // Don't let diagnostic gathering shadow the original error
      }
    }
    res.status(500).json({
      error: err.message ?? String(err),
      ...(recent_failures && recent_failures.length > 0
        ? { recent_failures }
        : {}),
    });
  }
});

// ─── 3. Legacy operation dispatcher (EchoBench compatibility) ─────────────
app.post("/lcp/dispatch", async (req, res) => {
  const { tool, operation, params } = req.body;
  if (tool !== "scout") {
    return res.status(404).json({ error: `Tool ${tool} not supported by Scout LCP` });
  }
  try {
    let result: any;
    switch (operation) {
      case "navigate":
        await engine.setBlockedResources(["image", "media", "font"]);
        result = await navigateTool(params.url);
        break;
      case "snapshot":
        result = await snapshotTool(params?.lite);
        break;
      case "click":
        result = await clickTool(params.id);
        break;
      case "type":
        result = await typeTool(params.id, params.text, params.clear);
        break;
      case "scroll":
        await scrollTool(params.direction, params.pixels);
        result = { status: "scrolled" };
        break;
      case "select":
        result = await selectTool(params.id, params.value);
        break;
      case "wait":
        await waitTool(params.condition, params.value, params.timeout);
        result = { status: "waited" };
        break;
      case "hover":
        result = await hoverTool(params.id);
        break;
      case "press_key":
        result = await pressKeyTool(params.key);
        break;
      case "new_tab":
        await engine.setBlockedResources(["image", "media", "font"]);
        result = await newTabTool(params.url);
        break;
      case "switch_tab":
        result = await switchTabTool(params.index);
        break;
      case "evaluate": {
        const page = await engine.getPage();
        result = await page.evaluate(params.code);
        break;
      }
      case "file_upload": {
        const page = await engine.getPage();
        const input = page.locator(`[data-scout-id="${params.id}"]`).first();
        await input.setInputFiles(params.path);
        result = { status: "uploaded" };
        break;
      }
      case "keyboard_type": {
        const page = await engine.getPage();
        await page.keyboard.type(params.text, { delay: params.delay ?? 20 });
        result = { status: "typed" };
        break;
      }
      case "keyboard_press": {
        const page = await engine.getPage();
        await page.keyboard.press(params.key);
        result = { status: "pressed" };
        break;
      }
      case "query_selector": {
        const page = await engine.getPage();
        const el = await page.locator(params.selector).first().elementHandle();
        result = { found: el !== null };
        break;
      }
      case "url": {
        const page = await engine.getPage();
        result = { url: page.url() };
        break;
      }
      case "get_cookies": {
        const page = await engine.getPage();
        result = await page.context().cookies();
        break;
      }
      case "clear_cookies": {
        const page = await engine.getPage();
        await page.context().clearCookies();
        result = { ok: true };
        break;
      }
      case "wait_for_selector": {
        const page = await engine.getPage();
        try {
          await page.waitForSelector(params.selector, { timeout: params.timeout ?? 5000 });
          result = { found: true };
        } catch {
          result = { found: false };
        }
        break;
      }
      case "screenshot": {
        const page = await engine.getPage();
        if (params.path) {
          await page.screenshot({ path: params.path });
          result = { path: params.path };
        } else {
          const buf = await page.screenshot();
          result = { screenshot: buf.toString("base64") };
        }
        break;
      }

      // ── EchoBench selector-based operations ──────────────────────────────
      case "click_selector": {
        const page = await engine.getPage();
        await page.locator(params.selector).first().click({ force: params.force ?? false });
        result = { ok: true };
        break;
      }
      case "is_visible": {
        const page = await engine.getPage();
        try {
          result = { visible: await page.locator(params.selector).first().isVisible() };
        } catch {
          result = { visible: false };
        }
        break;
      }
      case "text_content": {
        const page = await engine.getPage();
        try {
          result = { text: await page.locator(params.selector).first().textContent() ?? "" };
        } catch {
          result = { text: "" };
        }
        break;
      }
      case "fill": {
        const page = await engine.getPage();
        await page.locator(params.selector).first().fill(params.value ?? "");
        result = { ok: true };
        break;
      }
      case "html": {
        const page = await engine.getPage();
        result = { html: await page.content() };
        break;
      }
      case "wait_for_timeout": {
        await new Promise<void>(resolve => setTimeout(resolve, params.ms ?? 1000));
        result = { ok: true };
        break;
      }
      case "query_selector_all": {
        const page = await engine.getPage();
        const count = await page.locator(params.selector).count();
        result = { count, found: count > 0 };
        break;
      }
      case "set_input_files_selector": {
        const page = await engine.getPage();
        await page.locator(params.selector).first().setInputFiles(params.path);
        result = { ok: true };
        break;
      }

      default:
        return res.status(404).json({ error: `Operation ${operation} not supported` });
    }
    res.json(result);
  } catch (error: any) {
    console.error(`LCP Dispatch Error [${operation}]:`, error);
    res.status(500).json({ error: error.message });
  }
});

// ─── 4. Thought Stream (SSE) ──────────────────────────────────────────────
app.get("/lcp/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  const send = (data: any) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const interval = setInterval(() => {
    send({ event: "thought", module: "scout", payload: { status: "idle", timestamp: Date.now() / 1000 } });
  }, 5000);
  req.on("close", () => clearInterval(interval));
});

// ─── 5. Shutdown ──────────────────────────────────────────────────────────
app.post("/lcp/shutdown", requireSecret, (req, res) => {
  res.json({ status: "shutting_down" });
  setTimeout(() => process.exit(0), 500);
});

// ─── Port discovery ───────────────────────────────────────────────────────
const PORT_FILE = join(homedir(), ".scout", "lcp.port");

function writePortFile(port: number): void {
  try {
    mkdirSync(join(homedir(), ".scout"), { recursive: true });
    writeFileSync(PORT_FILE, String(port), "utf8");
  } catch (err) {
    console.error(`Failed to write ${PORT_FILE}:`, err);
  }
}

export function startLcpServer(port: number): Server {
  // port=0 → OS picks a free port (parallel cockpit, backward compat)
  // port>0 → fixed port; EADDRINUSE means another daemon is running — fail fast
  const server = app.listen(port, () => {
    const address = server.address();
    const actualPort =
      typeof address === "object" && address ? address.port : port;
    writePortFile(actualPort);
    console.error(`Scout LCP server running on port ${actualPort} (written to ${PORT_FILE})`);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE" && port > 0) {
      console.error(
        `Scout: port ${port} is already in use. Another Scout daemon is almost certainly already running. Stop it first: scripts/scout_baseline.sh --stop`
      );
      process.exit(2);
    }
    throw err;
  });

  // ── WebSocket pub-sub (same port, path /lcp/events) ─────────────────────
  const wss = new WebSocketServer({ server, path: "/lcp/events" });
  let _wsSeq = 0;

  wss.on("connection", (ws: WebSocket) => {
    const connId = `ws_${++_wsSeq}`;
    const activeSubIds = new Set<string>();

    ws.on("message", (raw) => {
      let msg: any;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (msg.type === "subscribe") {
        const conditions: Condition[] = Array.isArray(msg.conditions) ? msg.conditions : [];
        const subId = msg.session_id ? `${msg.session_id}_${connId}` : connId;
        activeSubIds.add(subId);
        engine.subscribe(subId, conditions, (evt) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(evt));
          }
        });
        ws.send(JSON.stringify({ type: "subscribed", sub_id: subId, conditions: conditions.map((c) => c.id) }));
      } else if (msg.type === "unsubscribe") {
        const subId = msg.session_id ? `${msg.session_id}_${connId}` : connId;
        engine.unsubscribe(subId);
        activeSubIds.delete(subId);
        ws.send(JSON.stringify({ type: "unsubscribed", sub_id: subId }));
      }
    });

    ws.on("close", () => {
      for (const subId of activeSubIds) engine.unsubscribe(subId);
      activeSubIds.clear();
    });
  });

  // Clean up port file on shutdown
  const cleanup = async () => {
    try {
      await fs.unlink(PORT_FILE);
    } catch {}
  };
  process.on("exit", () => {
    try {
      require("fs").unlinkSync(PORT_FILE);
    } catch {}
  });
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  return server;
}
