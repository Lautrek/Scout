# Scout

Hybrid A11y + Set-of-Marks browser MCP server. Gives AI agents a visually-grounded, semantically-precise view of any web page — without token explosion from raw HTML or hallucinated clicks from coordinate guessing.

## Why Scout?

Most browser MCP tools either dump raw HTML (expensive, noisy) or rely on coordinate-based clicking (fragile, hallucinates). Scout combines two complementary approaches:

- **Accessibility tree extraction** — scans the DOM for interactive elements, assigns each a stable numeric ID, returns a compact markdown summary
- **Set-of-Marks badges** — overlays numbered badges on a compressed screenshot so the agent can _see_ what it's clicking
- **State healer** — every action captures before/after state, telling the agent whether a click caused navigation, a modal, or a DOM change

The result: agents reference elements by ID (`scout_click(3)`), not by CSS selector or pixel coordinate. No hallucination, no token bloat.

## Quick start

```bash
npm install
npx playwright install chromium

# MCP stdio server (headed browser by default)
npm run dev

# Headless
SCOUT_HEADLESS=true npm run dev
```

### Claude Desktop / Claude Code

Add to your MCP config:

```json
{
  "mcpServers": {
    "scout": {
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "cwd": "/path/to/scout"
    }
  }
}
```

### Docker

```bash
docker build -t scout .
docker run -it scout
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `SCOUT_HEADLESS` | `false` | Run browser in headless mode |
| `SCOUT_BROWSER` | `chromium` | Browser engine (`chromium` or `firefox`) |
| `SCOUT_CDP_PORT` | `9229` | Chrome DevTools Protocol port for browser persistence |
| `SCOUT_VIEWPORT_WIDTH` | `1280` | Browser viewport width |
| `SCOUT_VIEWPORT_HEIGHT` | `800` | Browser viewport height |
| `SCOUT_MAX_ELEMENTS` | `1000` | Max elements per snapshot |
| `SCOUT_MAX_TABS` | `10` | Max open tabs |
| `SCOUT_PROFILE_DIR` | — | Path to persistent browser profile (cookies survive restarts) |
| `SCOUT_LOGIN_ENABLED` | `false` | Enable `scout_login` tool for automated social platform auth |
| `SCOUT_LCP_PORT` | — | Enable HTTP dispatch server on this port (optional) |

## Tools (27)

### Navigation
| Tool | Params | Description |
|---|---|---|
| `scout_navigate` | `url` | Navigate and return full snapshot |
| `scout_back` | — | Browser back |
| `scout_forward` | — | Browser forward |
| `scout_refresh` | — | Reload current page |

### Observation
| Tool | Params | Description |
|---|---|---|
| `scout_snapshot` | — | Full snapshot: numbered element list + badged screenshot |
| `scout_elements` | — | Element list only (faster, no screenshot) |
| `scout_screenshot` | — | Plain screenshot without badges |
| `scout_console_logs` | `clear?` | Last 100 browser console logs/errors |

### Interaction
| Tool | Params | Description |
|---|---|---|
| `scout_click` | `id` | Click element by snapshot ID |
| `scout_type` | `id, text, clear?` | Type into input (React-safe keyboard events) |
| `scout_select` | `id, value` | Select dropdown option |
| `scout_hover` | `id` | Hover over element |
| `scout_press_key` | `key` | Press keyboard key (Enter, Escape, etc.) |
| `scout_drag` | `sourceId, targetId` | Drag one element onto another |
| `scout_scroll` | `direction, pixels?` | Scroll up/down/left/right |

### Human-in-the-loop
| Tool | Params | Description |
|---|---|---|
| `scout_handoff` | `instruction, timeout?` | Show banner asking user to take manual action. Returns immediately with `handoff_id` — does NOT block. |
| `scout_handoff_check` | `handoff_id` | Poll whether handoff is completed/expired |
| `scout_handoff_cancel` | `handoff_id` | Cancel handoff and remove banner |

### Tabs
| Tool | Params | Description |
|---|---|---|
| `scout_tabs` | — | List all open tabs |
| `scout_switch_tab` | `index` | Switch active tab |
| `scout_new_tab` | `url?` | Open a new tab |

### Sessions
| Tool | Params | Description |
|---|---|---|
| `scout_save_session` | `name` | Save cookies + localStorage to `~/.scout-sessions/<name>.json` |
| `scout_load_session` | `name` | Restore a saved session (restarts browser context) |
| `scout_list_sessions` | — | List saved sessions |

### Performance
| Tool | Params | Description |
|---|---|---|
| `scout_wait` | `condition, value?, timeout?` | Wait for `navigation`, `network_idle`, `selector`, or `timeout` |
| `scout_block_resources` | `types` | Block resource types (e.g. `["image", "media"]`) |

### Login (opt-in)
| Tool | Params | Description |
|---|---|---|
| `scout_login` | `platform, username, password` | Automated social login with challenge detection. Requires `SCOUT_LOGIN_ENABLED=true`. |

## How it works

### Typical agentic loop

```
scout_navigate(url)
  → read numbered element list + badged screenshot
  → scout_click(3)          # healer returns stateChange
  → scout_snapshot()        # re-snapshot after state change
  → scout_type(7, "hello")
  → scout_handoff("Solve the CAPTCHA, then click Done")
  → scout_handoff_check(handoff_id)   # poll until completed
```

### Browser persistence

Scout writes the CDP port to `~/.scout-browser.port`. If the MCP process restarts, the next tool call reconnects to the still-running browser — tabs, sessions, and page state survive.

### Non-blocking handoff

Unlike blocking human-in-the-loop approaches, `scout_handoff` returns immediately with a `handoff_id`. The agent polls `scout_handoff_check` on its own schedule. The handoff banner re-injects across page navigations and auto-expires after timeout.

This matters because MCP tool calls often have timeouts (30-60s). A CAPTCHA that takes the user 2 minutes would kill a blocking approach.

### HTTP dispatch server (optional)

Set `SCOUT_LCP_PORT=8091` to expose an HTTP API alongside the MCP stdio transport. Useful for integrating Scout with non-MCP systems:

```
GET  /lcp/health              # Server status
POST /lcp/dispatch             # Execute tool operations
GET  /lcp/stream               # SSE event stream
```

## License

MIT
