# Scout

Hybrid A11y + Set-of-Mark browser MCP server. Gives agents a visually-grounded, semantically-precise view of any web page — without token explosion from raw HTML or hallucinated clicks from coordinate guessing.

## How it works

Every snapshot call:
1. **A11y extraction** — scans the DOM for interactive/visible elements, assigns each a `data-scout-id`, returns a numbered element list + markdown
2. **SoM badges** — injects blue numbered badges at each element's position, takes a compressed screenshot
3. **Healer** — click/type/select actions capture state before and after, returning what changed (`navigation`, `modal`, `dom_change`, `none`)

## Running

```bash
cd projects/scout
npm install
npx playwright install chromium  # first time only

# Dev (headed by default)
npm run dev

# Headless
SCOUT_HEADLESS=true npm run dev
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `SCOUT_HEADLESS` | `false` | Set `true` for headless mode |
| `SCOUT_CDP_PORT` | `9229` | Remote debugging port — browser persists across MCP restarts |
| `SCOUT_VIEWPORT_WIDTH` | `1280` | Viewport width |
| `SCOUT_VIEWPORT_HEIGHT` | `800` | Viewport height |
| `SCOUT_MAX_ELEMENTS` | `1000` | Max elements per snapshot |

## Tools

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
| `scout_snapshot` | — | Full snapshot: element list + badged screenshot |
| `scout_elements` | — | Element list only (faster, no screenshot) |
| `scout_screenshot` | — | Plain screenshot, no badges |
| `scout_console_logs` | `clear?` | Last 100 browser console logs/errors |

### Interaction
| Tool | Params | Description |
|---|---|---|
| `scout_click` | `id` | Click element by snapshot ID |
| `scout_type` | `id, text, clear?` | Type into input |
| `scout_select` | `id, value` | Select dropdown option |
| `scout_hover` | `id` | Hover over element |
| `scout_press_key` | `key` | Press keyboard key (Enter, Escape, etc.) |
| `scout_drag` | `sourceId, targetId` | Drag one element onto another |
| `scout_scroll` | `direction, pixels?` | Scroll up/down/left/right |

### Human-in-the-loop
| Tool | Params | Description |
|---|---|---|
| `scout_handoff` | `instruction, timeout?` | Show a banner in the live browser asking the user to take manual action (CAPTCHA, MFA, verification). Blocks until user clicks Done. Re-injects across page navigations. |

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
| `scout_block_resources` | `types` | Block resource types to speed up loading (e.g. `["image", "media"]`) |

## Typical agentic loop

```
scout_navigate(url)
  → scout_snapshot()        # see numbered elements + badged screenshot
  → scout_click(id)         # healer returns stateChange
  → scout_snapshot()        # re-snapshot after state change
  → scout_type(id, text)
  → scout_handoff("Complete the verification, then click Done")
  → scout_save_session("twitter")   # never log in again
```

## Browser persistence

Scout writes the CDP port to `~/.scout-browser.port`. If the MCP process restarts, the next tool call reconnects to the still-running browser — tabs and sessions survive.
