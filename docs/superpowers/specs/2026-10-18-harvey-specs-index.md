# Harvey specs: index and build order

Date: 18 Oct 2026. Overview: `docs/spec-reply-funnel-2026-10-18.md`. Today's reply engine and GHL tracker (built by others) are the base these plug into.

## The six specs
1. [Booking and call brief](2026-10-18-harvey-booking-and-call-brief.md): watches Kobi's calendar, moves the deal to Call booked, posts a call brief 2 hours before, spots no-shows.
2. [Post-call and proposal](2026-10-18-harvey-post-call-and-proposal.md): MeetGeek transcript (all pages) to a proposal and follow-up drafts via the proposal-generator skill, with day 2 and day 6 follow-ups.
3. [Close](2026-10-18-harvey-close.md): won gives a draft invoice, kickoff pack, claimed area and proof entry; lost records the reason, nudges at 90 days or blocks.
4. [Weekly autopilot](2026-10-18-harvey-weekly-autopilot.md): Monday source, find, route and stage a wave, one tap to load, Monday report.
5. [Dashboard](2026-10-18-harvey-dashboard.md): local page for replies, calls, funnel, campaign health and finder, with a demo mode for video.
6. [Marketplaces](2026-10-18-harvey-marketplaces.md): Upwork, Twine and Bark briefs scored, with a Loom script and cover note drafted for Kobi to record and submit.

## Shared pieces to build once (first, small)
- `shared/harvey/` helpers: Buzz post, state files with atomic writes, GHL `addNote(email, brand, text)` (new), `blockEverywhere`, Claude client with the three model names and a "never Fable" guard.
- Local server shell (used by dashboard and approval pages).

## Recommended build order (revised after adversarial review; today is Sun 18 Oct)
Targets: meetings from Wed 21 Oct, a client by Fri 30 Oct.

| Step | Build | Notes |
|---|---|---|
| 0 | Base: reply engine and GHL tracker (others, today) | Tracker gains `addNote` and a required `pipeline` parameter on `moveStage`. Kobi supplies his Motion link (`bookingUrl` in `config/harvey.json`) and runs one test booking Monday. |
| 1 | Booking link plus **spec 1 core** (watcher, exact-email match, Call booked, brief) | Runs on the VPS. Reuses the existing calendar.readonly token. |
| 2 | **Spec 2** post-call and proposal | Needed within a day of the first call. |
| 3 | **Spec 6** marketplaces, separate session, in parallel | Needs the Marketplace pipeline. VPS. |
| 4 | **Minimal dashboard**: Today plus Funnel, demo mode | Spec 5 v1. Campaign health and Finder are v2. |
| 5 | **Autopilot on Mon 26 Oct** | No segment scoring yet; Companies House limited companies only. |
| 6 | **Spec 3 v1**: Buzz checklist with invoice details pre-filled | FreeAgent and Stripe draft APIs are v2. |

## Binding rules across all six specs
- One label set: warm, maybe, referral, no, auto, left_company. `no` and `left_company` go to Lost automatically; no lost reason is asked, the reply text is the reason.
- Only an exact email match may move a stage or pull data. Domain match asks Kobi; name-only never acts; shared domains blocklisted.
- GHL opportunity value is estimated monthly value. Fee, first-year value and invoice total are custom fields.
- Time-critical jobs (calendar brief, no-show, Bark intake) run on the VPS. Everything else on the Mac.
- Nothing is sent to a prospect or client by Harvey. "Mark sent" is the trigger for Proposal sent.

## Open questions rolled up (recommended answers)
1. VAT registration per brand: tell Harvey; until then "plus VAT where applicable".
2. Send-as aliases for Stripped and Dealflow in Gmail: add them.
3. Stripe for Stripped and Dealflow international clients: bill from Kobestarr Stripe, brand named on the lines, for now.
4. Proposal delivery: PDF attached now, hosted page after the first client.
5. Weekly Outscraper cap £20 (about 12,500 results); wave about 600 leads.
6. Marketplace credit cap £30 a week; switch on Bark and Upwork alert emails today.
7. Claim radius default 5 miles (field `radiusMiles`).
8. Dashboard stays local, no phone view.
9. Edit Motion's confirmation text to say calls are recorded and transcribed.
