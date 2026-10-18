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

## Recommended build order (today is Sun 18 Oct)
Targets: meetings from Wed 21 Oct, a client by Fri 30 Oct.

| When | Build | Why |
|---|---|---|
| Sun 18 to Mon 19 | Reply engine and GHL tracker (in progress by others); Kobi does calendar OAuth and the Bark and Upwork alert settings | Everything else needs replies and stages. OAuth is Kobi-only and slow to fix later. |
| Mon 19 to Tue 20 | **1. Booking and call brief** (core: watcher, match, Call booked, brief) | First calls land Wednesday. The brief is the thing that wins them. |
| Tue 20 | **6. Marketplaces** in a separate session, in parallel | Independent, fast to cash, uses the Twine watcher already live |
| Wed 21 to Thu 22 | **5. Dashboard**, Today panel first (replies, calls, drafts) | Kobi can see the work waiting. Funnel and campaign health follow. |
| Wed 21 to Fri 23 | **2. Post-call and proposal** | The first call needs a proposal within a day. |
| Mon 26 | **4. Weekly autopilot** (first run by hand this week) | Keeps meetings coming for the week after the 30th. |
| Tue 27 to Thu 29 | **3. Close**: invoice draft and kickoff first; area claim and proof bank next | Needed the moment a deal lands, which could be Fri 30. |
| Fri 30 to Sun 1 | Dashboard remaining panels, demo mode, polish | Launch video screens |

LinkedIn email and DM surface from 26 Oct: the same reply handler and stages apply. Automation on Kobi's account stays off after the 15 Oct LinkedIn warning, so the Monday report counts LinkedIn only from manual or Kondo-logged activity.

## Open questions rolled up (recommended answers)
1. Google Workspace for kobestarr.io, OAuth project set to Internal: yes.
2. Proposal delivery: PDF attached now, hosted page after the first client.
3. Weekly Outscraper cap: £20 a wave. Wave size: about 600 leads.
4. Marketplace credit cap: £30 a week. Switch on Bark and Upwork emails today.
5. Local patch claim: town plus 5 miles by default.
6. No recurring billing plans automatically.
7. Dashboard stays local, no phone view.
