import express from "express";
import cors from "cors";
import { Server } from "http";
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
import { engine } from "./browser/engine.js";

const app = express();
app.use(cors());
app.use(express.json());

const startTime = Date.now();
const LCP_SECRET = process.env.SCOUT_LCP_SECRET ?? "";

// Authentication middleware — if SCOUT_LCP_SECRET is set, require it on all POST routes
function requireSecret(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (!LCP_SECRET) return next(); // no secret configured — local-only use
  const auth = req.headers["x-scout-secret"] as string
    ?? (req.headers.authorization?.replace("Bearer ", "") || "");
  if (auth !== LCP_SECRET) {
    res.status(401).json({ error: "Unauthorized — set X-Scout-Secret header" });
    return;
  }
  next();
}

// Apply auth to all mutation endpoints
app.use("/lcp/dispatch", requireSecret);
app.use("/lcp/forge", requireSecret);

// 1. State Inspection
app.get("/lcp/health", (req, res) => {
  res.json({
    status: "ok",
    service: "scout",
    uptime: (Date.now() - startTime) / 1000,
  });
});

// 2. Action Port
app.post("/lcp/dispatch", async (req, res) => {
  const { tool, operation, params } = req.body;

  if (tool !== "scout") {
    return res.status(404).json({ error: `Tool ${tool} not supported by Scout LCP` });
  }

  try {
    let result;
    switch (operation) {
      case "navigate":
        await engine.setBlockedResources(["image", "media", "font"]);
        result = await navigateTool(params.url);
        break;
      case "snapshot":
        result = await snapshotTool();
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
      default:
        return res.status(404).json({ error: `Operation ${operation} not supported` });
    }
    res.json(result);
  } catch (error: any) {
    console.error(`LCP Dispatch Error [${operation}]:`, error);
    res.status(500).json({ error: error.message });
  }
});

// 3. Thought Stream (SSE)
app.get("/lcp/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const interval = setInterval(() => {
    send({
      event: "thought",
      module: "scout",
      payload: { status: "idle", timestamp: Date.now() / 1000 },
    });
  }, 5000);

  req.on("close", () => {
    clearInterval(interval);
  });
});

// 4. Shutdown (graceful — requires auth if SCOUT_LCP_SECRET is set)
app.post("/lcp/shutdown", requireSecret, (req, res) => {
  res.json({ status: "shutting_down" });
  setTimeout(() => process.exit(0), 500);
});

export function startLcpServer(port: number): Server {
  const server = app.listen(port, () => {
    console.error(`Scout LCP server running on port ${port}`);
  });
  return server;
}
