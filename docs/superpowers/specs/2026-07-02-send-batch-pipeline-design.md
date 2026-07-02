# Design Spec: `send-batch` — CSV → verified → into the right campaign

**Date:** 2026-07-02
**Status:** Approved design, pending implementation plan
**Owner:** Kobi Omenaka

## Goal

One repeatable command: hand it a CSV (or a batch of new leads), name the campaign, and it
cleans, dedups, Reoon-verifies, personalises, and appends the survivors to that campaign's
dedicated Google Sheet. That sheet is watched by TaskMagic, which loads the new rows into a new
dated Mailead campaign and starts sending. The human touches nothing after dropping the CSV.

```
CSV  ──►  normalise  ──►  dedup  ──►  Reoon verify  ──►  naturalise  ──►  compose insight
                                                                                │
                                                                                ▼
                              record ledger  ◄──  append to campaign Google Sheet (tab ToSend)
                                                                                │
                                                                                ▼
                                            TaskMagic (per sheet) ──► new dated Mailead campaign ──► send
```

## The one command

```
node send-batch.js <path/to/file.csv> --campaign <key> [--dry-run] [--limit N]
```

- `--campaign <key>` names the target campaign (e.g. `ksd-doctors`). The key is looked up in the
  registry (see State) to find the sheet + carrier config.
- `--dry-run` reports exactly what would happen (row counts, dedup skips, Reoon credits required,
  sample composed rows) and spends **nothing**. Mandatory project rule: dry-run before any live run.
- `--limit N` caps how many rows are processed (useful for the 2-lead live test and for staying
  under the Reoon daily limit).

## Pipeline stages

Each stage is a small, independently testable unit with one job.

1. **Normalise** (`normalise-csv.js`)
   - Fuzzy-map arbitrary input headers to the canonical schema: `email`, `first_name`,
     `last_name`, `company_name`, `category`, `town`, `website`, `linkedin_url`.
     (`location → town`, `company → company_name`, etc.)
   - Preserve every unmapped column verbatim as a reference column.
   - Lowercase + trim emails for keying. Drop rows with no valid email.

2. **Dedup** (`dedup.js`) — three passes, all skips logged (never silently dropped):
   - **Within-file** by lowercased email.
   - **Global sent-ledger** (`data/sent-ledger.txt`, one email per line) — cross-campaign resend
     protection.
   - **Target sheet** — read the destination campaign sheet's existing emails live via the Sheets
     API and skip any already present (within-campaign duplicate protection).

3. **Verify (Reoon)** — reuse `shared/outreach-core/email-verification/reoon-verifier.js`.
   - Drop only `invalid / disposable / spamtrap`. Keep risky / unknown / catch-all / role / safe /
     valid (project rule: a sender still sees risky, but never a hard-bad address).
   - Respect the daily limit via `credentials-loader.js`; stop gracefully when quota throws.
   - Annotate rows with `reoonStatus`, `reoonScore`, `reoonSafe` in the reference block.

4. **Naturalise company** — reuse the existing naturalise logic to produce a clean `company_name`
   for cold copy (e.g. "Sheppards Chartered Accountants" → "Sheppards"). Original stays in the
   reference block.

5. **Compose insight (local campaigns only)** — build each active carrier field's packed value from
   its deterministic template (see Carrier fields). Skipped entirely for funded/standard campaigns.

6. **Append to the campaign sheet** — write survivors to the campaign's dedicated Google Sheet,
   tab `ToSend`, using the two-block layout (see Sheet layout). Header written once if the tab is
   empty; always `values:append` thereafter.

7. **Record + report** — append every pushed email to `data/sent-ledger.txt`; print counts
   (pushed / skipped-dupe / dropped-bad / verify-quota-remaining) and the clickable sheet URL.
   Optional WhatsApp ping via the clawdbot bridge.

## Carrier fields (the personalisation mechanism)

**Problem.** Mailead will not accept custom fields on the programmatic/TaskMagic append path. To
inject any personalisation, we must reuse a **standard** Mailead field.

**Principle.** Every mappable Mailead standard field has a declared **role**:

- **Real-use** — rendered in the email, mapped straight through: `first_name`, `email`,
  `company_name`.
- **Carrier** — never shown to the recipient, free to hijack: `last_name`, `linkedin_url`,
  `phone`, and any other standard field we do not put in front of the recipient. Each carrier holds
  a packed insight; **its original value is always preserved** in the reference block.

Example (a doctor): the email template references `{{last_name}}`, which actually renders the
insight:

> "Hi {{first_name}}, {{last_name}} {{company_name}}..."
> → "Hi Sarah, I noticed you don't really come up when people ask ChatGPT for a good cardiologist
>   in Wilmslow, Wilmslow Medical..."

A second carrier (e.g. `linkedin_url`) can carry a second personalised line for richer copy.

**Insight generation = deterministic templates.** Each carrier's insight is built from a
per-campaign template string with `{category}` / `{town}` / `{signal}` placeholders filled from the
row (mirrors the proven Lemlist `observationSignal` pattern). Cheap, consistent, and
cold-reader-auditable once per campaign. No LLM in v1 (optional `--llm-insight` is a later
enhancement, not in scope).

**Funded campaigns use zero carriers** — standard fields only, exactly as they run today.

## Sheet layout (tab `ToSend`, identical across all campaigns)

Two column blocks:

- **Reference block** (never mapped by TaskMagic — Kobi's source of truth): all originals with an
  unmistakable `real_` prefix — `real_first_name, real_last_name, real_email, real_company_name,
  real_category, real_town, real_website, real_linkedin_url` — plus Reoon annotations and any extra
  passthrough columns. (Prefix added 2026-07-02: `last_name` vs `Last Name` differed only by an
  underscore, too easy to mis-map in TaskMagic.)
- **Mailead block** (the only columns TaskMagic maps, named to match Mailead's field labels):
  real-use fields copied through; carrier fields filled with their packed insight. TaskMagic's rule
  is simply "map every column in the Mailead block to its like-named Mailead field."

This guarantees the original surname / LinkedIn URL / phone always survive for reference while the
Mailead-facing copy carries the injected values.

## State (Approach A — single orchestrator + plain-file state)

- `config/campaign-sheets.json` — the registry:
  `key → { sheetId, sheetUrl, label, carriers: { <mailead_field>: <insightTemplate> } }`.
  An empty/absent `carriers` map = standard-fields-only (funded). Presence of a registry entry is
  also how the system knows the campaign already has a sheet.
- `data/sent-ledger.txt` — every email ever pushed to any campaign sheet (one per line, lowercased).
  Committable, matching the existing `data/*.txt` convention.

**New campaign with no registry entry:** the script attempts auto-create via the service account
(`outreach-sheets@kobestarr-leadpipe.iam.gserviceaccount.com`), but **as of 2026 Google denies
service accounts Drive storage (403 storageQuotaExceeded, confirmed live 2026-07-02), so the manual
path is the real path:** Kobi creates a blank sheet inside the shared "Lead Pipelines" Drive folder
(which already grants the SA Editor), tab named `ToSend` (send-batch can rename the tab via API if
forgotten), then `node send-batch.js --register <key> <sheet URL>`. One manual step, once per new
campaign. Existing campaigns just work.

**Verify note (implementation deviation):** `BAD_STATUSES` also drops `disabled` (a dead mailbox is
a hard bounce) in addition to the spec's invalid/disposable/spamtrap. Leads with NO Reoon result
(daily-quota truncation) are skipped with `reoon_no_result`, never pushed unverified.

## Google Sheets access

Refactor the hand-rolled JWT Sheets client out of `push-to-sheet.js` into a shared helper
(`shared/outreach-core/sheets/sheets-client.js`) exposing: `readColumn(sheetId, tab, header)`
(for dedup), `appendRows(sheetId, tab, rows)`, and `createSheet(title, shareWith)`. No new npm deps
(keep the crypto-based JWT approach). Auth via `~/.credentials/outreach-sheets-sa.json`, scope
`https://www.googleapis.com/auth/spreadsheets` plus `drive.file` for create + share.

## TaskMagic flow (built once in the TaskMagic UI, cloned per sheet)

Watch the sheet's `ToSend` tab → on new rows → **create a new dated Mailead campaign**
`<key>-<YYYY-MM-DD>` (never re-upload an existing campaign; Mailead wipes leads on re-upload) → map
every Mailead-block column to its like-named field → start the campaign → WhatsApp the lead count.

Prefer the Mailead **app-action** step over browser record-and-replay (reliability, per the
TaskMagic verdict).

## What gets built vs configured vs done in the UI

- **Build (code):** `send-batch.js` orchestrator; shared `sheets-client.js`; `normalise-csv.js`;
  `dedup.js`; insight composer; ledger writer. Reuse existing Reoon + validation + naturalise
  modules.
- **Config:** registry entries + per-campaign carrier/insight templates (local campaign templates
  drafted for Kobi's cold-reader sign-off before first send).
- **Manual / TaskMagic UI:** one TaskMagic flow, cloned per campaign sheet.

## Validation / open item

**Confirm Mailead's actual mappable standard-field set** via a 2-lead live test (the vault already
flags this as needed). The carrier list is **config-driven**, so it is populated from whatever
Mailead genuinely exposes rather than hardcoded. This is the first validation gate before any
volume send.

## Explicitly out of scope (YAGNI)

- LLM-composed insights (deterministic templates only in v1).
- Per-row campaign routing / auto-split (whole batch → one campaign, named at drop time).
- Dedup against `businesses.db` (ledger + target-sheet only).
- Auto-creating the TaskMagic flow programmatically (built once in the UI, cloned).
- Changing the existing daily-funded engine (this pipeline sits alongside it; wiring the daily
  batch into `push-to-sheet.js`/`send-batch.js` is a follow-up, not this spec).

## Non-negotiable project rules carried in

- DB is sacred, gitignored, auto-backed-up (this pipeline does not touch it).
- Dry-run before every live/credit-spending run.
- Website-scraped emails auto-valid; everything else verified before a sender sees it.
- Subject lines never finalised without a cold-reader audit.
- No em dashes anywhere in generated copy; clickable links in all output.
- First email of a sequence never sent on a Friday (a Mailead/TaskMagic scheduling concern, noted
  for the flow, not enforced by this script).
