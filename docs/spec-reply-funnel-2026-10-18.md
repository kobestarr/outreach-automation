# Spec: reply handler, GHL funnel, deal pricing, dashboard (2026-10-18)

Status: DRAFT for Kobi's approval. Nothing below is built yet.
Goal: no reply ever sits unanswered again, every live conversation sits in one GHL pipeline per brand, and every deal arrives with a price ballpark.

## What exists today (checked 18 Oct)
- Mailead webhooks (reply + bounce) now reach the VPS again. They had been silent 17 Jul to 18 Oct.
- New replies and bounces post to Buzz ~outreach within 5 minutes.
- About 105 replies on 8890 and 155 unread in the Unibox have never been triaged.
- GHL: Kobestarr, Stripped Media and Dealflow Media sub-accounts all have only old template pipelines. None fits cold email.
- No credentials for the 27 sending mailboxes in the vault. Replies can only go out through the Mailead Unibox for now.

## Build order (by days to cash)

### 1. Reply backfill (first, read only)
- Read every reply in the Unibox (Chrome, read only), all campaigns since July.
- Classify each: interested, question, not now, wrong person (with referral), unsubscribe, OOO, bounce.
- Output: one list ranked hottest first, each with a drafted answer in house style.
- Kobi sends from the Unibox. Nothing is sent by Claude.

### 2. Reply handler (ongoing, option 1)
- Trigger: each email_answered webhook.
- Pulls the thread, classifies, drafts a reply in house style, attaches the price ballpark (section 4).
- Draft shows in the dashboard and in Buzz ~outreach with a link.
- v1 send: Kobi clicks "Copy + open thread", pastes into the Unibox and sends. Same mailbox, same thread, no credentials needed.
- v2 send (later, only if Kobi wants): one-click send from the dashboard, which needs app passwords for the 27 mailboxes stored in the vault.
- Unsubscribes and hard noes go straight to the Mailead blocklist. OOO replies get a resume date.

### 3. GHL funnel, one pipeline per brand
- New pipeline "Cold Email" in each of the Kobestarr, Stripped Media and Dealflow Media sub-accounts, with identical stages:
  Replied > Interested > Call booked > Proposal sent > Won | Not now | Lost
- Routing by sending brand (ghl-router.js routeLead): KSD mailboxes > Kobestarr, Stripped mailboxes > Stripped Media, Dealflow mailboxes > Dealflow Media.
- On reply: upsert contact, create opportunity at Replied, tag campaign + brand, note with the reply text.
- On classify = interested: move to Interested. Stage moves after that are Kobi's (or from calendar bookings).
- GHL stays the single record and never sends.
- Pipeline creation: check the live GHL API docs first; if the API cannot create pipelines, Kobi makes three in the UI from a 2-minute checklist.

### 4. Deal pricing enrichment
Runs when a reply is classified interested.
- UK company: Companies House accounts. Turnover if filed. Small firms often file without turnover, so fall back to staff count x revenue per employee for the sector, marked "estimate".
- US public company: SEC EDGAR revenue.
- US/other private or funded startup: last raise and headcount from the funded list, marked "estimate".
- Marketing budget = 6 to 10% of revenue (Gartner 2025: 7.7% average; small businesses 7 to 8%; funded startups 12 to 20%, used for that route).
- Kobi's fee ballpark = 10 to 25% of that marketing budget, shown monthly.
  Example: £1m turnover > £60k to £100k marketing > £500 to £2,000 a month.
- Written to the GHL opportunity value and a note, with sources and a confidence level.

### 5. Dashboard (local, localhost)
- Today: replies waiting with drafts, hottest first, oldest unanswered first.
- Funnel: count and value per stage per brand (from GHL).
- Campaign health: sent, reply rate, bounce rate per Mailead campaign, plus pending lead piles (e.g. the funded backlog).
- Refreshes every 5 minutes. No public hosting (contains lead data).

## Separate item found today: funded backlog
About 4,947 Reoon-safe funded leads built up unsent Jul to Oct (Dealflow 2,523, KSD 2,223, Stripped 195). Before loading:
re-verify anything older than 30 days (Reoon 2,100/day, so about 3 days), newest first, then load into existing campaigns by brand and route via the campaign-builder skill.

## Out of scope / needs Kobi
- LinkedIn automation stays off (LinkedIn warning, 15 Oct).
- Sending any email: Kobi only.
