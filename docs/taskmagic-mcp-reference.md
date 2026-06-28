# TaskMagic MCP — cross-project automation (how to use)

**Set up 2026-06-22.** TaskMagic is now drivable from Claude in EVERY project via MCP (user scope). This is the canonical how-to.

## What TaskMagic is
A general no-code automation platform (built on **Activepieces**), bundled inside **Mailead** as the "Automations" app — but the engine is **general-purpose, NOT Mailead-specific**. It can power automations for any project/brand. The MCP drives Kobi's whole TaskMagic workspace ("Kobi's Workspace").

## Connection (already wired)
- MCP server name: **Taskmagic** (user scope → available in every project/session).
- Endpoint: `https://apps-mcp.taskmagic.com/api/v1/mcp/<TOKEN>/sse` (SSE).
- Token lives in `~/.claude.json` (user config). **Sensitive — controls the whole workspace.** Rotate in Mailead → Automations → MCP if leaked.
- Tools appear as `mcp__Taskmagic__*` **only after a session restart** following any (re)add. If you don't see them, the session predates the add — restart.

## What it can drive (whole spectrum)
- **Flows** — build/manage automations (triggers + actions).
- **Tables** — TaskMagic's own data store; use as staging tables (no Google Sheet needed).
- **Runs** — execute + monitor.
- **Connections / Pieces** — external integrations (Google Sheets, Slack, hundreds of apps). Add via the MCP screen "Add Piece" → then they become callable tools. **"0 pieces" = none added yet**, so initially the MCP exposes TaskMagic's own flow/table tools, not external-service actions.

## Reliable vs flaky (critical — do not get this wrong)
- **RELIABLE:** the cloud flow engine — app-action/API integrations + short scrapes. Drive this via the MCP.
- **FLAKY, never load-bearing:** the separate **"Open browser automation app"** (record-and-replay) for no-API sites. Founder says it works as a "scrape leg" but breaks when chaining scrape + send + clicks. Independent review 5.5/10, "not suitable for business-critical automation."

## When to use TaskMagic vs Claude Code + VPS
- **Default to Claude Code + VPS** for anything with an API, plain HTML scraping, headless, or scheduled — cheaper, more reliable, higher volume.
- **Use TaskMagic for:** (a) automations *inside* the Mailead/TaskMagic ecosystem where no API exists (e.g. loading leads into a Mailead campaign), (b) the genuinely-unique browser cases — **Facebook Groups** and **Instagram** logged-in scrape/DM (accept account-ban risk; supervised, short runs only).
- Full verdict + sources: `outreach-automation/docs/taskmagic-use-case-verdict.md`.

## How any project uses it
The `mcp__Taskmagic__*` tools are in every session (user scope). Introspect them, then build/run flows and tables. Same philosophy as the GHL CLI: drive the tool from code, skip the painful UI.
