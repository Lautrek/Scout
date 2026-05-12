/**
 * Scout MCP Proxy — thin stdio MCP shim that forwards to the Scout daemon
 * via the LCP HTTP server.
 *
 * Architecture (parallel cockpit):
 *
 *     Claude Code ─stdio→ mcp_proxy ─HTTP→ ┐
 *     Gemini CLI  ─stdio→ mcp_proxy ─HTTP→ ┼─ Scout daemon (1)
 *     <any TUI>   ─stdio→ mcp_proxy ─HTTP→ ┘    └ Studio Baseline browser
 *
 * Each TUI spawns its own proxy (cheap, stateless, ~10 ms per call).
 * The daemon owns Playwright state and is shared across all proxies.
 *
 * Discovery: reads ~/.scout/lcp.port written by the daemon. If the daemon is
 * down, the proxy fails fast with a clear instruction to run scout_baseline.sh.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { z, ZodRawShape } from "zod";

const PORT_FILE = join(homedir(), ".scout", "lcp.port");
const SECRET = process.env.SCOUT_LCP_SECRET ?? "";

interface ToolDef {
  name: string;
  description: string;
  inputSchema: any;
}

function readDaemonPort(): number {
  // SCOUT_LCP_PROXY_PORT set in .mcp.json takes precedence (fixed-port setups).
  if (process.env.SCOUT_LCP_PROXY_PORT) {
    const p = parseInt(process.env.SCOUT_LCP_PROXY_PORT, 10);
    if (Number.isFinite(p) && p > 0) return p;
  }
  // Port file written by daemon on startup (auto-port setups).
  try {
    const raw = readFileSync(PORT_FILE, "utf8").trim();
    const p = parseInt(raw, 10);
    if (Number.isFinite(p) && p > 0) return p;
  } catch {}
  throw new Error(
    `E_DAEMON_UNREACHABLE: Scout daemon not running (${PORT_FILE} missing or empty). Start it with: scripts/scout_baseline.sh`
  );
}

const port = readDaemonPort();
const baseUrl = `http://localhost:${port}`;

async function lcpFetch(path: string, init?: RequestInit): Promise<any> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (SECRET) headers["X-Scout-Secret"] = SECRET;
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, { ...init, headers });
  } catch (err: any) {
    throw new Error(
      `E_DAEMON_UNREACHABLE: Scout daemon at ${baseUrl} refused connection. Start it with: scripts/scout_baseline.sh`
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`E_DAEMON_HTTP_${res.status}: LCP ${path} ${res.status}: ${body || res.statusText}`);
  }
  return res.json();
}

async function waitForDaemon(timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${baseUrl}/lcp/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `E_DAEMON_UNREACHABLE: Scout daemon not reachable at ${baseUrl}. Start it with: scripts/scout_baseline.sh`
  );
}

/**
 * Translate a JSON Schema property into a Zod type. We mirror only what the
 * daemon's tool_registry produces (string/number/boolean/array/enum).
 */
function jsonPropToZod(prop: any): any {
  let zt: any;
  if (prop.enum) {
    zt = z.enum(prop.enum);
  } else {
    switch (prop.type) {
      case "string":
        zt = z.string();
        break;
      case "number":
      case "integer":
        zt = z.number();
        break;
      case "boolean":
        zt = z.boolean();
        break;
      case "array":
        zt = z.array(prop.items ? jsonPropToZod(prop.items) : z.any());
        break;
      default:
        zt = z.any();
    }
  }
  if (prop.description) zt = zt.describe(prop.description);
  return zt;
}

function jsonSchemaToShape(schema: any): ZodRawShape {
  const shape: ZodRawShape = {};
  if (!schema?.properties) return shape;
  const required = new Set<string>(schema.required ?? []);
  for (const [key, prop] of Object.entries(schema.properties)) {
    const zt = jsonPropToZod(prop);
    shape[key] = required.has(key) ? zt : zt.optional();
  }
  return shape;
}

async function main() {
  await waitForDaemon();

  const { tools } = (await lcpFetch("/lcp/tools")) as { tools: ToolDef[] };

  const server = new McpServer({ name: "scout-proxy", version: "0.1.0" });

  for (const tool of tools) {
    const shape = jsonSchemaToShape(tool.inputSchema);
    server.tool(tool.name, tool.description, shape, async (args: any) => {
      const result = await lcpFetch("/lcp/tools/call", {
        method: "POST",
        body: JSON.stringify({ name: tool.name, arguments: args }),
      });
      return result;
    });
  }

  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Scout MCP proxy connected to daemon at ${baseUrl} (${tools.length} tools)`);
}

main().catch((err) => {
  console.error("Scout MCP proxy fatal:", err.message ?? err);
  process.exit(1);
});
