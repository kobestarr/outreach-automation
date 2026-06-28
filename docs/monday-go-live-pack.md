# Monday Go-Live Pack — NW Professional Services

**Created:** 2026-06-12. Everything needed to send the first batch Monday. Decisions are locked (Kobi, 2026-06-12); this is assembly.

## Locked decisions
- **Approach:** TaskMagic Cloud automation (Kobi has Cloud, runs unattended). Build once, reuse for every batch. *Fallback if TaskMagic snags: hand-load the CSV into one Mailead campaign, ~30 min, still sends Monday.*
- **Channel:** Prosp LinkedIn request + same-day email that references it. Same day, or next day at latest.
- **Reply tracking:** Gmail primary (where Kobi works), mirror into the **Kobestarr Digital GHL subaccount** once it's connected to the tooling (not the Flixwatcher one).
- **Scope:** 85 pilot first, then batch-2 (231) queued behind it.

## The lists (ready)
- Pilot: `exports/pilot-ksd-pro-services-nw-2026-06-10.csv` (85 firms)
- Batch 2: `exports/batch2-ksd-pro-services-nw-2026-06-12.csv` (231 firms)
- Copy: `exports/pilot-ksd-pro-services-sequence.md`

## 1. Mailead campaign settings
- **One campaign per batch** (overwrite rule). Name: `ksd-pro-nw-pilot-2026-06-15`.
- **Sequence:** Day 0 email (below) → Day 3 nudge → Day 7 final. (3-step unless Kobi prefers shorter.)
- **Sending mailboxes (confirmed 2026-06-12):** use the **9 Kobestarr Digital boxes only** for brand coherence with the AI-visibility pitch — `kobi@ / kobi.o@ / kobi.omenaka@` across `trykobestarrdigital.com`, `kobestarr.digital`, `kobestarrdigital.com`. Do NOT use the DealFlow or Stripped boxes here (those suit the funded-founders / podcast-authority campaign, different identity). `kobestarr.io` is reserved for Lemlist, not Mailead (Kobi's rule). All 9 are warmed (deliverability 91-99).
- **Pacing:** gentle ramp ~10-15/box/day to start (so ~90-135/day across 9 boxes). Pilot 85 = ~1 day (~10/box). Batch-2 231 = ~2-3 days. Business hours Europe/London, Mon-Fri.
- **From:** the 9 KSD boxes. Signature says "Kobi, Kobestarr Digital" linking kobestarr.io. Subject line: PICK from the audit options in the sequence doc, do not send the placeholder.

> Total usable Mailead inventory = **27 boxes** (9 DealFlow + 9 Stripped + 9 Kobestarr Digital). The other 18 are for other campaigns, not this one.

## 2. TaskMagic Cloud automation recipe (build once, reuse)
Plain-English spec to set up in TaskMagic (it builds from a description, then you approve steps):

> "When I add rows to the Google Sheet tab 'ToSend', take those leads and add them to a new campaign in Mailead named with today's date, mapping columns first_name, email, company, category, town to the campaign's lead fields. Then notify me on WhatsApp that the campaign is built with the count."

Notes for setup:
- Use TaskMagic's **Mailead app action** for the add-to-campaign step where available (more reliable than browser clicking); fall back to browser automation only if needed.
- Run it **on Cloud, on-demand** per batch (or scheduled weekly). A run this size is a few minutes.
- **Cloud-hour budget: tier 5 = 6 hours/month**, shared across ALL automations. Plenty for lead-loading (minutes per run), but DON'T waste it on long browser-automation/scraping runs. Keep heavy scraping off TaskMagic (e.g. the Twine watcher already runs free on clawdbot).
- Make sure the email on your TaskMagic account matches your Mailead account so the integration links.

## 3. Prosp (LinkedIn, same day)
- Import the same CSV (it carries `linkedin_url`).
- Connection-request note = "Day 0, touch 1" in the sequence doc.
- Fire the LinkedIn requests the **same morning** the email batch goes, so the email's "I just sent you a connection request" line is true.

## 4. Gmail reply capture (so nothing slips)
- Since Mailead replies now land in normal Gmail: create a Gmail label `KSD-Outreach-Replies` + a filter (from the lead domains, or simplest: any reply to the campaign sending addresses) so replies are visible at a glance.
- Same-day response habit. A booked call is the goal, not closing in-thread.
- GHL mirror added once the Kobestarr Digital subaccount is connected.

## What I still need from you (small)
1. **Subject line pick** from the 4 audit options (or your own), so the email is final.
2. Confirm **3-step (Day 0/3/7) vs shorter** sequence.
3. **Connect the Kobestarr Digital GHL subaccount** to the tooling when convenient (the connected one is Flixwatcher; the KSD sub-account exists under your agency but isn't reachable by the integration yet). I'll fetch GHL's live setup docs and walk it then. Not a Monday blocker — Gmail label covers replies until it's wired.

Resolved 2026-06-12: mailboxes (9 KSD boxes, pacing above), TaskMagic = Cloud tier 5 / 6 hrs-month.
Once 1 and 2 are answered, the pilot goes Monday morning.
