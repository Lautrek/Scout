# Contributing to Scout

## Development

```bash
npm install
npx playwright install chromium
npm run dev          # headed browser, stdio MCP
npm run build        # TypeScript → dist/
npm test             # run tests
```

## Project structure

```
src/
├── index.ts              # MCP tool registration + startup
├── lcp.ts                # Optional HTTP dispatch server
├── browser/
│   ├── engine.ts         # Browser lifecycle, CDP connect/launch modes
│   ├── discovery.ts      # Scan for running browsers with debug ports
│   ├── a11y.ts           # Accessibility tree extraction
│   ├── som.ts            # Set-of-Marks badge overlay
│   └── healer.ts         # Before/after state detection
└── tools/
    ├── navigate.ts       # scout_navigate
    ├── snapshot.ts       # scout_snapshot
    ├── elements.ts       # scout_elements
    ├── screenshot.ts     # scout_screenshot
    ├── click.ts          # scout_click
    ├── type.ts           # scout_type
    ├── select.ts         # scout_select
    ├── scroll.ts         # scout_scroll
    ├── hover.ts          # scout_hover
    ├── press_key.ts      # scout_press_key
    ├── drag.ts           # scout_drag
    ├── wait.ts           # scout_wait
    ├── nav_extra.ts      # scout_back, scout_forward, scout_refresh
    ├── tabs.ts           # scout_tabs, scout_switch_tab, scout_new_tab
    ├── session.ts        # scout_save_session, scout_load_session, scout_list_sessions
    ├── login.ts          # scout_login (opt-in via SCOUT_LOGIN_ENABLED)
    └── handoff.ts        # scout_handoff, scout_handoff_check, scout_handoff_cancel
```

## Adding a new tool

1. Create `src/tools/your_tool.ts` exporting an async function
2. Register it in `src/index.ts` with `server.tool()`
3. Add Zod schemas for parameters
4. Return `{ content: [{ type: "text", text: ... }] }`
5. Update the Tools table in `README.md`

## Code style

- TypeScript strict mode
- Zod for all parameter validation
- No classes for tools — export plain async functions
- Console output goes to `stderr` (stdout is MCP stdio transport)
