# Harvey 2: post-call and proposal

Date: 18 Oct 2026. Status: design, not built. Follows: booking-and-call-brief. Uses Kobi's skill `kobestarr-tools/skills/custom/proposal-generator` (also loads `how-we-sell` and `brand-voice`). Harvey does not reinvent the proposal. It fills the skill's form and follows its rules.

## Goal
Within 30 minutes of a call ending, Kobi has a proposal and a follow-up email waiting as drafts. Nothing reaches the prospect until Kobi sends. Day 2 and day 6 follow-ups are drafted automatically. Objections and next steps land in GHL.

## Trigger
`call-state.js` marks a call `ended` when its calendar end time passes. `postcall-run.js` (Mac LaunchAgent, every 10 minutes) asks MeetGeek for the meeting. When a transcript exists, it runs the flow once per call.

## Units (`shared/harvey/`)
1. `meetgeek-client.js`: `getTranscript(meetingId)` loops on `pagination.next_cursor` (URL-encoded `?cursor=`) until empty. It returns all sentences and the page count. A transcript from a single call is **never** accepted as complete: if a page returned 500 sentences and no cursor was followed, the run fails loudly. Key from the vault. Confirm fields against the live MeetGeek docs first.
2. `call-extract.js`: Haiku 5.5 turns the transcript into the skill's form fields: prospect name, company, business description, problem (their own words, quoted), solution, tools, timeline, cost, email, plus optional definition of win, budget signals, objections, next steps, call outcome (`send_proposal|no_fit|no_show`). Every field carries a `quote` pointer. Empty fields stay empty. Harvey never invents the "magic question" answer (skill rule: skip that section).
3. `fee-suggest.js`: cost = the budget Kobi or the prospect said on the call, else the pricing ballpark from the reply engine (10 to 25% of marketing budget, monthly). It proposes a figure and a range.
4. `proposal-build.js`: runs the skill's flow. Opus 5.5 makes call one (`problemPitch`, `solutionPitch`, `title`, `platformList`), then call two (four milestones with timelines), using the skill's few-shot pattern and its rules (spartan tone, descriptions under 14 words, British English, no em dashes, problem longer than solution, 2 to 3 pages). Output: `data/harvey/proposals/<callId>/proposal.html` and `.pdf`.
5. `followup-draft.js`: Sonnet 5.5 writes the send email (house style: no dashes, warm first name, one real proof point matched by buyer type from the proof bank, soft next step) and the two follow-ups.
6. `ghl-notes.js`: `addNote(email, brand, text)`. **New export the GHL tracker needs** (if absent, build it there, not here).

## Approval gate
The skill's own rule: extracted data is approved before the proposal generates. Harvey posts the extracted form to Buzz with a link to a local page `localhost:<port>/call/<callId>` (served by the dashboard server) where Kobi edits fee, timeline and scope and presses "Generate". Fallback CLI: `node harvey.js approve <callId> --fee 1500`. Opus only runs after approval, so cost is spent only on real proposals.

## Outputs for Kobi
- Draft A: proposal PDF plus the HTML source. Quality checklist from the skill run as code: problem section longer than solution; cost of inaction in currency; every service maps to a stated pain; their words appear; pricing clear; at most 3 pages; plain-English terms; obvious next step. Failures are listed on the draft and block "ready".
- Draft B: follow-up email text with the proposal attached or linked.
- Delivery v1: PDF attached to the email Kobi sends from his own mailbox. Hosted page, e-signature and Stripe deposit button (the skill's self-hosted option) are v2.
- Where drafts live: dashboard "Today", plus a Buzz post with "Copy + open".

## Stage rule
GHL moves to **Proposal sent** only when Kobi has sent. Detection: Gmail Sent (same check the reply engine uses) shows a message to the prospect with the proposal attached or its link; fallback is a "Mark sent" button. Then `moveStage(email, brand, 'Proposal sent')` and the sent date is stored.

## Follow-ups
- Day 2 and day 6 after the sent date, 09:00 UK, Mon to Fri (weekend moves to Monday).
- Drafted on the day from the skill's follow-up pattern, referencing the call and one objection. Posted to Buzz and the dashboard.
- Cancelled automatically if the prospect replies (Gmail inbound or Unibox), the stage changes, or Kobi marks lost or won.
- After day 6 with silence: Buzz asks "Not now or Lost?" and Kobi chooses. Harvey does not choose.

## Objections and next steps
After approval, `addNote` writes: date, outcome, objections (quoted), agreed next step, fee proposed, link to the transcript. The opportunity value is set to the proposed fee, so the dashboard funnel shows pipeline value.

## No-show and no-fit
`no_show` hands back to spec 1 (nudge). `no_fit` posts "no proposal suggested" with the reason and waits; Kobi may override.

## Failure modes
- Transcript not ready after 3 hours: Buzz alert, retry hourly for a day.
- Transcript truncated (page limit): fail, never draft from partial text.
- Two prospects on one call: draft per attendee email only if both are matched; otherwise ask.
- Model refusal or bad JSON: retry once, then post raw notes to Buzz.

## Tests
Pagination loop across 3 fake pages including empty-cursor end and a missing-cursor failure; extraction leaves unknowns empty; checklist catches a short problem section and an em dash; no Opus call before approval; stage moves only on Sent detection; follow-up cancelled on reply; weekend date maths.

## Stays human
Fee, scope, wording, sending, deciding Not now or Lost.

## Open questions for Kobi
1. Proposal delivery for 30 Oct: PDF attached to your email, or a hosted link with sign and pay? Recommended: PDF now, hosted page after the first client.
2. Is Opus 5.5 per proposal acceptable (a few pounds each)? Recommended: yes, only after your approval.
