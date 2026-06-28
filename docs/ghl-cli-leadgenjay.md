# GoHighLevel CLI (LeadGen Jay) — what it is, why it matters

**Found:** 2026-06-12 in `~/Downloads/gohighlevel-cli-main.zip`. Extracted to
`~/Development/One Hour Vibe Coder/gohighlevel-cli/`. Built by Lead Gen Jay.

## Why this is a big deal
Kobi's problem: "everything in GHL is super manual." This CLI drives GHL from the terminal (and lets Claude drive it), covering the **full GHL surface**: contacts, opportunities, calendars, **workflows**, conversations (send SMS/email), email campaigns, payments, forms, **social posting**, locations. Plus a **Blotato** module (social/Instagram posting API) and a **Nextcloud** module.

**It uses the exact same credential we're already creating.** `GHL_API_KEY` = the Private Integration Token; `GHL_LOCATION_ID` = the sub-account ID. So the one token Kobi is generating for the Kobestarr Digital sub-account powers **all three**: the GHL MCP, this CLI, and (with one extra step) workflow creation.

## Two API layers (important)
| Layer | Auth | Can do |
|---|---|---|
| **Public** (`services.leadconnectorhq.com`) | `GHL_API_KEY` (PIT) | Read everything; create contacts/opportunities/conversations/social posts. **Workflows are read-only.** |
| **Internal** (`backend.leadconnectorhq.com`) | Firebase refresh token (grabbed by the bundled Chrome extension) | Everything the GHL UI can do, **including creating/updating workflows and email sequences.** |

So: contacts, replies, pipeline, social posting all work with just the PIT. To **build automations/email nurtures programmatically**, also grab the Firebase token via the Chrome extension (`chrome-extension/` → load unpacked → "Grab Refresh Token").

## The killer feature for us: `builders/`
Python scripts that turn a **markdown email-sequence doc into a live GHL workflow** (`--update` to redeploy without duplicating). Examples included: course-interest (10 emails/14 days), high-ticket (5 emails + SMS), post-call sales (tag-triggered branches), Consulti free-trial nurture (8 emails), post-purchase (6 emails). **This is how we make the outreach follow-up + nurture non-manual:** author the sequence in markdown, deploy to GHL as a real workflow.

## How it plugs into the £30k plan
1. **Reply/lead tracking:** `ghl contacts create --tag` + opportunities, scripted, no manual GHL clicking. Push emailed leads into the Kobestarr Digital pipeline automatically.
2. **Nurture sequences:** use `builders/` to deploy our email follow-ups as GHL workflows.
3. **Instagram/social:** `ghl social create-post` (or the Blotato module) for the "everything is manual" social problem.
4. **Claude-driven:** ships a Claude Code skill (`cli_anything/gohighlevel/skills/SKILL.md`) so Claude can run `ghl ...` on Kobi's behalf.

## Setup (when token is ready)
1. `cd ~/Development/One\ Hour\ Vibe\ Coder/gohighlevel-cli && ./install.sh` (creates `.venv`, installs click/prompt-toolkit/requests/rich, copies `.env`). *Reviewed: benign.*
2. Edit `.env`: `GHL_API_KEY=pit-...`, `GHL_LOCATION_ID=<Kobestarr Digital location id>`.
3. Smoke test: `./ghl contacts list --limit 5`.
4. Optional (for workflow building): load `chrome-extension/` unpacked in Chrome → grab Firebase token → `GHL_FIREBASE_REFRESH_TOKEN=...` in `.env`.
5. Optional: copy the SKILL.md into `~/.claude/skills/gohighlevel-cli/` and put `ghl` on PATH so Claude can drive it.

## Command surface (from SKILL.md)
`contacts` (list/get/create/update/delete/search/add-tag/remove-tag) · `opportunities` (+pipelines) · `calendars` (slots/appointments/book) · `workflows` (list; create via internal API) · `conversations` (list/messages/**send** SMS+email) · `emails` (campaigns/templates) · `payments` (transactions/invoices/create-invoice) · `forms` · `social` (accounts/posts/**create-post**) · `locations`. `--json` on reads for piping to jq. Bare `ghl` = interactive REPL.

## Security
`.env` is gitignored. The Firebase refresh token = full GHL session, treat as a password, only grabbed locally by the extension (no network calls). PIT rotatable in GHL every 90 days.
