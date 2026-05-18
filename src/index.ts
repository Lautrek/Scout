/**
 * Scout daemon entrypoint.
 *
 * Runs:
 *   - stdio MCP transport (for direct attachments / legacy)
 *   - LCP HTTP server (parallel cockpit — multiple TUIs proxy through this)
 *
 * All tool definitions live in tool_registry.ts (single source of truth).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TOOLS } from "./tool_registry.js";
import { startLcpServer } from "./lcp.js";
import { engine } from "./browser/engine.js";

const server = new McpServer({ name: "scout", version: "0.1.0" });

// Register every tool from the registry
for (const tool of TOOLS) {
  server.tool(tool.name, tool.description, tool.schema, tool.handler as any);
}

// Graceful shutdown
process.on("SIGINT", async () => {
  await engine.close();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await engine.close();
  process.exit(0);
});

// Start LCP HTTP server (always, unless explicitly disabled).
// SCOUT_LCP_PORT can be:
//   - a specific port number
//   - "auto" / "0" — OS picks a free port (recommended for parallel cockpit)
//   - "off" — disable HTTP entirely (stdio-only mode)
const lcpPortEnv = process.env.SCOUT_LCP_PORT ?? "auto";
if (lcpPortEnv !== "off") {
  const requested =
    lcpPortEnv === "auto" || lcpPortEnv === "0" ? 0 : parseInt(lcpPortEnv, 10);
  startLcpServer(requested);
}

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Scout MCP server running on stdio");
