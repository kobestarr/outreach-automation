# Harvey 4: weekly autopilot

Date: 18 Oct 2026. Status: design, not built. Builds on `2026-10-18-email-finder-integration-design.md`.

## Goal
Every Monday the next wave is ready and waiting. Kobi taps once to approve. Nothing is loaded into Mailead, and nothing is sent, before that tap.

## Schedule
- Mon 06:30 UK: `weekly-run.js` (Mac LaunchAgent) sources, enriches, finds, routes, stages. Mon 07:30: Monday report posts to Buzz. Approval can happen any time after staging.
- A wave is staged in daily slices if it exceeds the Reoon allowance (2,100 a day), continuing Tue and Wed. The report says so.

## Units (`shared/harvey/`)
1. `segment-picker.js`: `pickSegments({ history, claims, caps })`. Score = meetings per 100 sent over the last 4 waves, with a floor so one new segment is always tried (explore 1 in 4). Excludes: pubs, cleaning, window and gutter and carpet for trades, any trade and area in `data/claimed-areas.json`, anything on `data/do-not-contact.txt`, PR and in-person roles. Returns up to 3 segments with reasons.
2. `wave-run.js`: calls the existing scripts in order, each with its dry-run first: `explore-area-businesses.js` (Outscraper, budget cap in pounds per wave, default from `config/harvey.json`) or the funded backlog; `add-ch-owners.js`; `enrich-owner-emails.js` (finder adapter, **daily Reoon credits only**, never `useReserve`); `assemble-local-mailead.js` or `assemble-funded-mailead.js`; `send-batch.js --dry-run`. A step failure stops the wave and reports; it never skips.
3. `route-to-campaign.js`: uses `finder-route.js` (main, inbox, probable, excluded) and `config/campaign-sheets.json` to map each pile to an **existing** Mailead campaign. No campaign for a pile: it is held in `data/held-*.csv` and the report says "build campaign for X" (campaigns are built once in the UI via the `mailead-campaign-builder` skill).
4. `stage-wave.js`: writes `data/harvey/waves/<date>/wave.json` with counts per pile, sample rows, credits, cost, and the exact `load-to-mailead.js` commands. Nothing loaded.
5. `approve-wave.js`: the one tap. Dashboard button "Approve wave" (localhost) or `node harvey.js approve-wave <date>`. It runs `load-to-mailead.js` per pile (existing dedupe, ledger, retry, idempotent), then posts the result.
6. `monday-report.js`: builds the Buzz post.

## Rules baked in
- First touch never on Friday: approving on Friday queues the load for Monday 07:00. Mon to Thu only.
- Funded and international lists: Reoon safe only. UK local and professional: risky allowed (existing rules).
- Newest monthly drop first; re-verify anything older than 30 days (finder `lastVerified`).
- Sending caps per mailbox stay in Mailead; Harvey only reports lead piles waiting against campaign capacity.
- A wave over the spend cap or over the credit allowance stops and asks.

## Monday report (Buzz ~outreach, plain text)
- Sent last 7 days, by brand.
- Replies by label: interested, question, not now, wrong person, unsubscribe, OOO, bounce.
- Meetings booked and held; no-shows.
- Deals and value by stage per brand (from GHL), won this week.
- Best segment (meetings per 100 sent) and worst; why we lose (lost reasons).
- Credits used: Outscraper pounds, Reoon today and week, Icypeas, finder status mix.
- Next wave: segments chosen with reasons, counts per pile, anything held, "Approve" link.
- Sources: Mailead `get_user_campaigns` plus `events.jsonl` on the VPS, GHL, finder budget.

## Failure modes
- Mailead API or sheet 403 (service account cannot create sheets): the blank sheet needed per campaign is listed in the report; staging is unaffected.
- Reoon allowance spent: remaining rows held, stated in the report.
- Outscraper empty or cap hit: wave smaller, never retried blindly.
- Mac asleep at 06:30: runs on wake, report says "late". 
- Duplicate approval: `load-to-mailead.js` is idempotent; the tap shows "already loaded".
- Approved wave older than 5 days: re-verify before loading.

## Tests (fakes only)
Segment scoring and the explore slot; claimed-area exclusion; excluded categories; step failure stops the wave; no `useReserve` ever (assert option); Friday approval defers; nothing loads without approval (assert no `add_lead` call); held pile when no campaign; report numbers match fixtures; stale wave re-verifies.

## Stays human
Approval tap, building campaigns in the Mailead UI, sheets sharing, subject lines and sequences (cold-reader audit), sending decisions.

## Open questions for Kobi
1. Weekly Outscraper spend cap? Recommended: £20 a wave (about 5,000 results at $0.002), reviewed after week two.
2. Should the first autopilot run be Mon 26 Oct, with this week's wave run by hand? Recommended: yes.
3. Weekly wave size? Recommended: about 600 leads to start (2 to 3 Mailead campaigns), raised only while bounce stays under 3%.
