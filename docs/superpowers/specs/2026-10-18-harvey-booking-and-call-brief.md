# Harvey 1: booking and call brief

Date: 18 Oct 2026. Status: design, not built. Parent: `docs/spec-reply-funnel-2026-10-18.md`.

## Goal
Every booked call, from any source, moves the deal to Call booked and puts a one-screen brief in Buzz ~outreach two hours before. If someone does not show, Kobi gets a nudge draft.

## How code reads the calendar (decision)
Pick: **Google Calendar API, read-only OAuth** (scope `calendar.readonly`, calendar kobi@kobestarr.io), polled every 10 minutes with a sync token.
- Why not the secret iCal URL: Google's iCal feeds can lag by many hours, which breaks a 2-hour brief. The URL is also a password in a link.
- Why the API: near-live, returns the event description (intake answers), attendees and a changed/cancelled flag.
- Cost: one-time OAuth consent, refresh token in `~/.credentials/api-keys.json`. If the Google project is in "Testing" mode the token dies after 7 days, so set it to Internal (Workspace) or publish it.
- Fallback if OAuth is not ready by Wed: the iCal URL, with the brief window widened to 4 hours.
- Fetch the live Google Calendar API docs before building (Kobi's API recency rule).

## Units (all under `shared/harvey/`)
1. `calendar-source.js`: `listChangedEvents({ syncToken })` returns normalised events `{ id, start, end, summary, description, attendees[], status, source }`. Source guess from summary/link: `motion`, `manual`, `other`.
2. `intake-parser.js`: `parseIntake(description)` returns `{ topic, budgetBand, timeline, raw }`. Haiku 5.5 extracts, regex first for Motion's known labels. Never throws; returns `raw` only if unsure.
3. `prospect-match.js`: `matchProspect(event)` returns `{ match, how, confidence }`. Order: attendee email against `data/sent-ledger.txt`, Mailead loaded files, GHL contacts; then company domain (never freemail domains); then fuzzy name against the summary. `how` is `email|domain|name|none`. Name-only matches are labelled "unconfirmed" in the brief.
4. `call-state.js`: `data/harvey/calls.json` (atomic write), keyed by calendar event id: `{ eventId, start, prospectEmail, brand, ghlStage, briefedAt, startHash, noShowChecked }`.
5. `brief-builder.js`: `buildBrief(call)` returns plain text for Buzz (Sonnet 5.5 only for the 3 questions and the offer line; every fact comes from data, not the model).
6. `booking-run.js`: the job. LaunchAgent every 10 minutes on Kobi's Mac, catches up after sleep.

## Flow
1. New or changed event with an external attendee: match, store, then `moveStage(email, brand, 'Call booked')`. No match: create nothing in GHL, post "Unmatched booking" to Buzz with the intake answers so Kobi can link it.
2. Brand comes from the sending mailbox of the original email; unmatched defaults to Kobestarr.
3. Brief fires when start is within 2h10m and `briefedAt` is empty. Booked inside 2 hours: brief at once.
4. Start time changed: update the record, re-brief at the new T minus 2h. Cancelled: post to Buzz, keep stage, draft a reschedule note.

## The brief (one Buzz post)
- Who and firm, role, brand, how matched.
- Their reply thread: last 3 messages, newest first.
- Revenue and price ballpark: Companies House or SEC EDGAR figure, marked "filed" or "estimate", marketing budget 6 to 10%, Kobi's fee 10 to 25% monthly. Read from the GHL opportunity note the reply engine wrote; if missing, call the shared pricing function.
- ChatGPT visibility result from `check-ai-visibility.js` output for that prospect. Missing for a local trade: run it once (one cheap call, capped at 5 a day).
- Intake answers: topic, budget band, timeline. Flag a mismatch with the ballpark.
- 3 suggested questions, tied to the intake and the thread.
- Likely offer: one of Kobi's offers, chosen by rule (local trade > AI visibility; funded startup > funded offer; professional services > audit-first), with a fee range.
- Links: GHL opportunity, Meet link, MeetGeek note.

## No-show detection
15 minutes after start, ask MeetGeek `GET /v1/meetings` for the window. No meeting for that event, or one under 3 minutes with a single participant: mark `noShowCandidate`. Post to Buzz: "Possible no-show: <name>" with a Sonnet draft (kind, no guilt, two new slots from free calendar gaps, Motion link). GHL does not move back; a note is added. Kobi sends. Check again at 60 minutes in case MeetGeek is late. MeetGeek field names to be confirmed from live docs.

## Failure modes
- OAuth expired: Buzz alert "calendar watcher blind" after 2 failed runs.
- Mac asleep at T minus 2h: next run still briefs if the call has not started; after start it posts "late brief".
- Duplicate attendee in two brands: first send wins, note both.
- Any enrichment missing: the brief still posts with "not available" lines. A brief is never blocked.

## Tests (`node --test`, fakes only)
Intake parsing of three real Motion descriptions; match order (email beats domain beats name, freemail ignored); brief fires once; reschedule re-briefs; cancel; unmatched path; no-show rules; brief with every enrichment missing.

## Stays human
Taking the call, sending any nudge, deciding the offer, linking unmatched bookings.

## Open questions for Kobi
1. Is kobestarr.io a Google Workspace account? Recommended: yes, set the OAuth project to Internal so the token never expires.
2. Do you want the brief also on WhatsApp? Recommended: Buzz only, plus WhatsApp only if the brief is late.
