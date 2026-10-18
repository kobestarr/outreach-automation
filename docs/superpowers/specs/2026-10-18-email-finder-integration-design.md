# Email finder integration: design

**Date:** 18 Oct 2026. **Branch:** `feat/email-finder-integration` (from `feat/profile-views-ramp`, which carries the Buzz poller).
**Status:** design approved in chat by Kobi; this spec awaits his review.
**Source of truth for the finder:** `kobestarr-tools/.worktrees/email-finder/engines/email-finder/HANDOVER.md` (sections 3, 4, 6a, 7).

## Goal

Make Kobi's internal email finder the email-finding step for Mailead campaigns, so more firms get a confirmed owner address, every lead is routed by how sure we are of its address, and every bounce teaches the shared memory.

## Decisions (Kobi, 18 Oct)

1. Approach: call the finder **library** row by row from this repo through a small adapter. Never copy finder code here. One finder, one memory (`~/.kobestarr/email-finder/finder.db`).
2. Generic-inbox campaign uses the **same sequence with one tweak** in line 1 (draft for Kobi's approval, e.g. "Hi Dave, hoping this reaches you rather than the general inbox.").
3. Live test: **wave 1 benchmark** (comparison only, never loaded) **plus wave 2** (next ~111 local firms, electricians and heating) through the full pipeline, results shown before any Mailead load.
4. The 30-day Reoon skip is exact: add a read-only `lastVerified(email)` to the finder library (kobestarr-tools, on its own branch `feat/_kobestarr-email-finder`).
5. Daily Reoon credits only. Never `useReserve` / `--use-reserve` unless Kobi says so.
6. Ties into the Harvey build (`docs/spec-reply-funnel-2026-10-18.md`): bounce loop now; reply-handler and dashboard hooks later (see Out of scope).

## Units

### 1. Finder adapter: `shared/outreach-core/enrichment/email-finder-adapter.js`
- `loadFinderLib({ env, exists })`: resolves the finder code the same way `~/.local/bin/email-finder` does: `EMAIL_FINDER_HOME`, then `kobestarr-tools/.worktrees/email-finder/engines/email-finder`, then `kobestarr-tools/engines/email-finder`; requires `index.js` from the first that has `cli.js` and `node_modules`. Throws a clear error naming the paths tried.
- `openFinder({ maxCredits, maxIcypeas, lib })`: returns the library's finder with `useReserve: false` forced. `lib` is injectable for tests.
- No finding logic lives here.

### 2. Owner email choice: `shared/outreach-core/enrichment/owner-email.js`
New pure function `chooseOwnerEmail({ pick, finderResult })`, where `pick` is the existing `pickBestEmail` result. Precedence:
1. Scraped `owner-match` or `owner-freemail`: kept; finder is never called for these rows.
2. Finder personal address: `found`, `found_flagged`, or `catch_all_found` / `icypeas_found` with confidence `high`.
3. Scraped `role` address (info@ etc.).
4. Finder `found_generic`.
5. Finder `catch_all_found` / `icypeas_found` with confidence `low` (Icypeas `probable`).
6. Scraped `staff` address.
7. Nothing. A scraped non-owner `freemail` address is dropped.

Returns `{ email, email_rule, email_source: 'scraped'|'finder'|'', email_status, email_confidence, email_suggested }`. For scraped picks, `email_status` is `scraped_owner`, `scraped_role` or `scraped_staff`. `email_suggested` is copied from the finder's `suggested_email` and is never sendable. `resolveOwnerEmail` (3-guess loop) stays exported but `enrich-owner-emails.js` stops calling it.

### 3. Enrichment: `enrich-owner-emails.js`
- Scrape as today. If the pick is owner-match/owner-freemail, keep it. Otherwise call `finder.findOne({ owner_first, owner_last, website, company_name })`, then `chooseOwnerEmail`.
- Rows with a website but no owner name still get `findOne` (the finder returns the generic inbox for company-only rows).
- `--no-guess` skips the finder. New `--max-credits N` (passed to the finder; default: the finder's daily-only budget) and `--max-icypeas N` (default 0 until Icypeas is topped up).
- New CSV columns: `email_status, email_confidence, email_suggested, email_source, email_checked_at` (ISO time of the finder call, audit only). Existing columns unchanged.
- The `.jsonl` resume file stores the new fields. Finder errors on one row: record `email_status=error`, carry on. Finder budget exhausted (`skipped`/`not_run`): stop finding, keep scraped picks, report how many rows to re-run.
- Report at the end: counts by `email_status` and `email_rule`, Reoon and Icypeas credits used (from the finder's budget).
- Core logic moves into an exported `enrichRows(rows, io)` with injected `scrape`, `finder`, `appendJsonl`, so it is testable; the CLI wires the real ones.

### 4. Routing: `shared/outreach-core/campaigns/finder-route.js` + `send-batch.js`
- Pure `routeFor(row)` returns `main | inbox | probable | excluded` plus a reason:

| email_status | confidence | route |
|---|---|---|
| `found`, `found_flagged`, `scraped_owner` | any | main |
| `catch_all_found`, `icypeas_found` | high | main |
| `catch_all_found`, `icypeas_found` | low | probable |
| `found_generic`, `scraped_role`, `scraped_staff` | any | inbox |
| empty (legacy list, no finder columns) | | main (behaviour unchanged) |
| anything else (`unverifiable`, `left_company`, `catch_all_unresolved`, `not_found`, `suppressed`, `error`, ...) | | excluded |

- A row whose `email` is empty is always excluded. `email_suggested` is never read by routing or loading.
- `config/campaign-sheets.json` per campaign: `finderRoutes: { inbox: "<campaign key>", probable: "<campaign key>" }`. `send-batch.js --campaign <key>` pushes main rows to `<key>` and the others to their route keys, each through the existing dedupe, verify and sheet steps. A route with no key configured writes `data/held-<key>-<route>.csv` and is reported, never dropped silently. Excluded rows go to `data/excluded-<key>-<date>.csv` with reasons.
- Dedupe adds a **company-domain** check against `data/sent-ledger.txt` and every `data/mailead-loaded-*.txt`: a row is skipped if its email or its own website domain was already loaded. Freemail domains are never used for domain matching.
- Reoon re-check is skipped for a row when `email_source=finder` and `finder.lastVerified(email)` returns a time within 30 days. All other rows are verified exactly as today (UK local keeps risky; funded stays safe-only per the existing rules).

### 5. Finder addition (kobestarr-tools, branch `feat/_kobestarr-email-finder`)
`lastVerified(email)` on the object returned by `createEmailFinder`: returns `verified_at` (ms) from `store.cachedVerification(email)` (already returns null past the 30-day TTL), else null. Read only, with its own test in the finder's suite. No other finder change.

### 6. Bounce loop: `mailead-alerts-buzz.js`
- For each `email_bounced` event: `finder.importBounce(email, 'mailead bounce ' + campaign)`, then post to Buzz as now.
- If the finder cannot load or throws: still post the alert, and append the address to `data/bounces-pending.csv`; the next successful run imports pending rows first and clears the file. The event-log offset only moves forward after both steps.
- Extracted into a testable function `handleEvents(events, { post, importBounce, pending })`.
- No VPS change: the receiver already logs bounces to `events.jsonl`, which this poller reads.

### 7. Generic-inbox sequence
`exports/local-established-sequence-2026-10.md` gets an inbox variant: identical emails, line 1 tweaked. Kobi approves the line before the campaign is built.

## Testing
- `node --test`, injected fakes only (no network, no credits): adapter path resolution; `chooseOwnerEmail` precedence (every row of the table); `enrichRows` (finder skipped for owner-match, called otherwise, error and budget-exhausted rows, resume); `routeFor` (every status); send-batch routing with fake sheets/verify (held route, excluded file, domain dedupe, Reoon skip only when `lastVerified` is within 30 days); `handleEvents` (bounce imported, finder failure writes pending, offset rule).
- Adversarial review of the implementation (separate checker, sees output only).

## Rollout
1. Finder `lastVerified` merged on its branch (tests green).
2. OA tests green, adversarial review fixes applied.
3. Wave 1 benchmark: re-run the 50 unfinished wave 1 firms through `enrichRows` (live finder, daily credits, comparison table only, nothing loaded).
4. Wave 2: take the next ~111 firms (electricians, heating) from the established list, run `lookup-maps-by-name.js` (Google Places, inside the 1,000 free calls a month) and `add-ch-owners.js`, then `enrich-owner-emails.js`, `assemble-local-mailead.js` and `send-batch.js --dry-run`.
5. Show Kobi: counts by status and route, credits used, sample rows, held and excluded files. **No Mailead load until Kobi says go.** Then build campaigns with the `mailead-campaign-builder` skill (inbox campaign with the tweaked line 1); Kobi launches.

## Out of scope (hooks noted for the Harvey build)
- Reply handler: "wrong person, try X" calls `findOne` for X; "remove me" calls `finder.suppress`.
- Dashboard: finder status mix and credits per day.
- Funded daily batch and other legacy finders (`email-discovery/`, `icypeas-finder.js`, `pattern-generator.js`): unchanged for now.
- Probable campaign: no Mailead campaign until Icypeas is topped up; those rows are held.
