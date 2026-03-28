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

// 4. Self-Mutation Port (Forge)
app.post("/lcp/forge", (req, res) => {
  res.json({ status: "restarting", message: "Applying Forge mutations... Scout will restart in 1 second." });
  
  setTimeout(() => {
    process.exit(0);
  }, 1000);
});

export function startLcpServer(port: number): Server {
  const server = app.listen(port, () => {
    console.error(`Scout LCP server running on port ${port}`);
  });
  return server;
}
