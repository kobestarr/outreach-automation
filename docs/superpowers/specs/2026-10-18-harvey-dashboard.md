# Harvey 5: dashboard

Date: 18 Oct 2026. Status: design, not built. Extends section 5 of `docs/spec-reply-funnel-2026-10-18.md`.

## Goal
One local page that shows what needs Kobi now, how the pipeline looks, whether campaigns are healthy and how the finder is doing. It holds lead data, so it is never hosted.

## Rules
- Runs on Kobi's Mac only: Node `http` server bound to `127.0.0.1:4747`. No auth needed, no external listener. A LaunchAgent keeps it up.
- A refresher LaunchAgent (`dashboard-refresh.js`) runs every 5 minutes, gathers all data, writes `data/harvey/dashboard-state.json` atomically. The page reads that file, so it loads instantly and API calls are not made per page view. The page re-fetches the state every 5 minutes and shows "updated 14:35".
- Each panel fails alone: a failed source shows "source down since 14:10" with the last good numbers greyed. The page never goes blank.
- Build step zero (Kobi's design rule): a numbered contact sheet with a wireframe and a mockup of each layout option before any final page. Design panel review for the Today panel (glanceable in under 2 seconds).

## Units (`shared/harvey/dashboard/`)
1. `collectors/`: one file per source, each `collect() -> { ok, at, data }`. `replies.js`, `calls.js`, `funnel.js` (GHL), `campaigns.js` (Mailead), `piles.js`, `finder.js`.
2. `state.js`: merges collectors, never throws.
3. `server.js`: `GET /` (page), `GET /api/state`, `GET /call/:id` (approval form from spec 2), `POST /api/approve-wave`, `POST /api/mark-sent`, `GET /demo` (see below).
4. `public/index.html`: one file, plain CSS and JS, no build step.

## Panels
### Today
- Replies waiting: sorted hottest first, then oldest first. Row: name, firm, brand, label, age, draft preview, buttons "Copy + open thread" (copies the draft, opens the Unibox or Gmail thread) and "Mark answered".
- Calls today: time, name, firm, brief status, link to the Buzz brief, no-show flag.
- Unanswered over 24 hours: red strip at the top with the count. A reply counts as answered only if Gmail Sent or the Unibox shows Kobi's reply.
- Drafts ready: proposals, follow-ups due today, 90-day nudges, marketplace drafts.
### Funnel
Per brand (Kobestarr, Stripped Media, Dealflow Media): count and value per stage, Replied through Won, Not now, Lost; week-on-week change; Marketplace pipeline shown separately.
### Campaign health
Per Mailead campaign: sent, reply rate, bounce rate (red over 3%, amber over 2%), sending state, leads left. Under it, lead piles waiting (funded backlog, staged wave, held files) and the "Approve wave" button.
### Finder
Status mix (found, found_flagged, catch_all_found, found_generic, unverifiable, not_found, suppressed, error), Reoon credits used today against 2,100, Icypeas, per-day bars for 14 days. From the finder store, read only.

## Data sources
GHL API per brand; Mailead `get_user_campaigns` and `events.jsonl` (fetched from the VPS read-only); Gmail Sent and the Unibox check (shared with the reply engine); `data/harvey/*.json`; finder budget file; `data/held-*.csv`.

## Screens worth capturing for launch videos
Funnel with real stage counts; Today with a drafted reply and a call brief beside it; Campaign health with bounce under 3%; Finder status mix; the "Approve wave" tap. Add `?demo=1`: swaps every name, email, firm and money value for fixed fake data, so Kobi can record without exposing leads. Demo mode is a build requirement. Real company logos shown are official marks from `_assets/logos/`.

## Failure modes
Collector timeout (8 seconds each, run in parallel); GHL rate limits (one call per pipeline per refresh); port in use (Buzz alert); stale state older than 15 minutes (banner); never writes to GHL or Mailead except through the named buttons.

## Tests
Each collector against fixtures; state merge when one collector fails; sorting rules for replies; answered logic; demo mode leaves no real string (scan output for fixture emails); server binds to loopback only; approve endpoint refuses double use.

## Stays human
Every send, every approval.

## Open questions for Kobi
1. Phone view when away? Recommended: no, local only. Use Buzz alerts when out.
2. Show money values on screen by default? Recommended: yes, hidden in demo mode.

## Revisions after adversarial review (18 Oct 2026, binding)
- **Scope (30 Oct, v1).** Build **Today plus Funnel only**. Campaign health and Finder are v2 (their collectors exist as stubs returning "not built"). Demo mode ships in v1 for Funnel and Today.
- **Security (M8).** Bind to `127.0.0.1` only. Every POST route checks `Origin` and `Host` (must be `127.0.0.1:4747` or `localhost:4747`) and requires a per-session token. The token is generated at server start, injected into the page, and sent in a header. GET routes that expose lead data check Host too (blocks DNS rebinding). Tests assert a POST without token, with a foreign Origin, or with a foreign Host is refused.
- **Funnel numbers (minor).** Week-on-week uses the daily funnel snapshots (`data/harvey/funnel-YYYY-MM-DD.json`) that spec 4 writes. Until a week exists, show "no comparison yet". Values are estimated monthly value (M7); proposal fee, first-year and invoice totals are separate custom fields and shown separately.
- **Answered logic (minor).** De-dupe Gmail and Unibox by message id before deciding a reply was answered.
- **Labels (M6).** Reply rows use: warm, maybe, referral, no, auto, left_company.
- **Marketplace.** Shown as its own pipeline row once spec 6 exists.
- **Run place (M9).** Dashboard server and refresher stay on the Mac. VPS-only state (calls, marketplace) is fetched read-only over SSH on each refresh.
- **Build.** Fourth in the order, after specs 1, 2 and 6.
