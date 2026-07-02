# TaskMagic flow brief — ksd-pro-services sheet → Mailead (build via MCP)

**Written 2026-07-02, for the session after restart (mcp__Taskmagic__* tools will be loaded).**
Context: `docs/superpowers/specs/2026-07-02-send-batch-pipeline-design.md` + memory `reference-send-batch-pipeline`.

## What to build

One TaskMagic Cloud flow (the reliable flow engine, NOT the browser automation app):

- **Source:** Google Sheet `1xcyH8DetTxqJWBfWRicAl0FEYyVJ8FvZ6F46W-k_D08` (Outreach ToSend - ksd-pro-services), tab `ToSend`. 816 rows are already in it.
- **Action:** create a **NEW Mailead campaign** named `ksd-pro-services-<YYYY-MM-DD>` (never re-upload an existing campaign; Mailead deletes leads on re-upload) and add the rows as leads.
- **Column mapping (map ONLY the Title Case columns; ignore every column starting `real_` and the reoon* columns):**
  - `First Name` → Mailead First Name
  - `Last Name` → Mailead Last Name (this carries the packed insight phrase, NOT a surname — by design)
  - `Email` → Mailead Email
  - `Company Name` → Mailead Company Name
- **Then:** WhatsApp Kobi (447989746146) the campaign name + lead count via the clawdbot bridge (or TaskMagic's own notify step if simpler).
- **Trigger:** on-demand / manual run per batch (NOT an always-on poller — cloud hours). A "new rows in sheet" trigger is acceptable only if it doesn't burn cloud hours idling.

## Validation gates (in order — do not skip)

1. **2-lead test first:** run the flow limited to the first 2 data rows (Peter / peter@bevan.co.uk and Narendra / nmistry@hurst.co.uk — their Last Name cells are EMPTY because they predate the carrier config; perfect canaries). Confirm in Mailead: both leads landed, fields mapped, campaign created with today's date.
2. **Lock the field set:** note exactly which lead fields Mailead's app-action exposes. If it differs from First Name/Last Name/Email/Company Name, update `MAILEAD_LABELS` in `shared/outreach-core/campaigns/sheet-rows.js` + the spec.
3. Only then run the full 816.

## Before any SEND happens (not just load)

- The Mailead sequence copy must be adapted to use `{{last_name}}` as the insight slot per `docs/insight-templates.md` (body line: `I had a quick look and saw {{company_name}} {{last_name}}.`). Subject already cold-reader-audited: `AI search for {{company_name}} {{first_name}}`.
- First touch Mon-Thu only (house rule). Send via KSD identity mailboxes.
- The two canary leads (Peter/Narendra) have EMPTY Last Name → the template would render a gap. Either delete them from the campaign before sending or accept two imperfect sends (they are real leads already ledgered).

## Account prerequisites (from SOP Part C)

- TaskMagic account email must equal the Mailead account email for the integration to link.
- If the Mailead app-action piece isn't added yet in TaskMagic ("0 pieces"), add the piece first via the MCP/connections screen.
