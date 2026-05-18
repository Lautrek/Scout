#!/usr/bin/env bash
# Scout MCP Proxy launcher.
#
# Spawned by each MCP client (Claude Code, Gemini CLI, ...). Auto-starts the
# Scout daemon if it's not running, then runs the thin stdio proxy.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT_FILE="$HOME/.scout/lcp.port"
BASELINE="$SCRIPT_DIR/../../scripts/scout_baseline.sh"

if [[ -f "$SCRIPT_DIR/.env" ]]; then
    set -a; source "$SCRIPT_DIR/.env"; set +a
fi

# Ensure the daemon is up. scout_baseline.sh is idempotent and fast.
if [[ ! -f "$PORT_FILE" ]] || ! curl -fs --max-time 2 "http://localhost:$(cat "$PORT_FILE" 2>/dev/null || echo 0)/lcp/health" >/dev/null 2>&1; then
    bash "$BASELINE" >/dev/null 2>&1 || {
        echo "Failed to start Scout daemon. Run scripts/scout_baseline.sh manually for diagnostics." >&2
        exit 1
    }
fi

cd "$SCRIPT_DIR"
TSX="$SCRIPT_DIR/node_modules/.bin/tsx"
if [[ -x "$TSX" ]]; then
    exec "$TSX" src/mcp_proxy.ts
else
    exec npx tsx src/mcp_proxy.ts
fi
