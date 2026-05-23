# Cardiologist Bounce Mine Report

**Scope:** Jan 1 – Mar 31 2024 Gmail bounce notifications, cross-referenced against `/tmp/cardiologist-emails-for-bounce-mine.tsv` (357 cardiologists).

**Generated:** 2026-05-23, ahead of Lemlist re-send Tue 2026-05-26.

## Method

Searched Kobi's Gmail across the campaign window with multiple bounce-detection queries:
- `from:mailer-daemon` (Google DSNs)
- `from:postmaster` (recipient-org DSNs)
- `subject:"Delivery Status Notification"`
- `subject:"Undelivered"`
- `"550" after:2024/1/1 before:2024/3/31`

Walked each thread, paired the SENT recipient with the bounce-from-postmaster message, classified the bounce code from the snippet/body, and cross-referenced against the cardiologist list. Verified the most-ambiguous threads (NHS Exchange "A problem occurred" and "Message blocked 550 5.4.1") by fetching the full message bodies.

## Headline numbers

- **303 unique threads** loaded across all queries (Jan 1 – Mar 31 2024)
- **338 bounce messages** parsed (many recipients bounced multiple times across follow-ups)
- **290 unique recipient addresses** with at least one bounce
- **12 cardiologists** confirmed as **hard bounces** → exclude from Tue 26 May send
- **4 cardiologists** with **soft / domain-not-found** patterns → flag but do NOT exclude
- **~218 cardiologists** had Gmail "Send mail as" misconfig errors in the window (sender-side problem at the time, not recipient-side) → do NOT exclude
- **5 cardiologists** had NHS Exchange "554 Too many hops" infrastructure loops (Feb 8 2024 batch via amses.net SMTP relay) → do NOT exclude
- **Already-excluded (hardcoded):** `j.grapsa@rbht.nhs.uk`, `d.w.s.chong@gmail.com`, `dwschong@gmail.com`

## Hard bounces — EXCLUDE from 26 May send (12 emails)

Output file: `/tmp/cardiologist-bounce-exclusions.txt` (one email per line, lowercase).

| Email | Name | Send Date | Bounce Code / Reason |
|---|---|---|---|
| c.monaco@imperial.ac.uk | Claudia Monaco | 2024-01-12 | 550 5.1.1 Address not found |
| john.silberbauer@kcl.ac.uk | John Silberbauer | 2024-01-15 | 550 5.4.1 Recipient address rejected: Access denied (KCL Outlook policy) |
| jonathanbehar@gmail.com | Jonathan Behar | 2024-02-27 | 550 Message blocked by Google |
| k.kotseva@imperial.ac.uk | Kotseva Kornelia | 2024-01-12 | 550 5.1.1 Address not found |
| kkaloud@otenet.gr | Konstantinos Kaloudis | 2024-02-27 | 550 5.1.1 Address not found |
| laura.corsinovi@rbch.nhs.uk | Laura Corsinovi | 2024-01-15 | 550 5.4.1 Recipient address rejected |
| olegsk@gmail.com | Olegs Kacanovs | 2024-02-27 | 550 Message blocked |
| sitara.khan@kcl.ac.uk | Sitara Khan | 2024-01-12 | 550 5.4.1 Recipient address rejected: Access denied (KCL) |
| tomasz.fryzlewicz@cardioanalytics.com | Tomasz Fryzlewicz | 2024-01-12 | 550 5.4.1 Recipient address rejected |
| tscallaghan@aol.com | Stanley Callaghan | 2024-01-15 | 550 5.1.1 Address not found |
| victoria.parish@kcl.ac.uk | Vicky Parish | 2024-01-12 | 550 5.4.1 Recipient address rejected: Access denied (KCL) |
| xenofon.krinos@cmft.nhs.uk | Xenofon Krinos | 2024-01-15 | 550 5.4.1 Recipient address rejected |

**Notes on the 12:**

- 4 are "address not found / mailbox-doesn't-exist" — permanent hard bounce regardless of sender.
- 4 are KCL / Imperial / CMFT / RBCH Outlook returning `550 5.4.1 Access denied` — organisational anti-spam policy that rejects cold senders. Likely to fire again from any new IP/domain. Exclusion is prudent for protecting Lemlist domain reputation.
- 3 are Gmail "Message blocked" (account-level spam policy) for personal Gmail/AOL addresses — likely already blocklisted Kobi's domain.
- 1 (`tomasz.fryzlewicz@cardioanalytics.com`) is a corporate Trustwave SEG block — same as KCL category.

## Domain-not-found bounces (informational; NOT excluded)

Four addresses bounced because the **whole domain didn't resolve** in Jan 2024 — possibly the org rebranded or the domain typo'd. The Lemlist re-send list should sanity-check whether the domain is now live; if so, send. If still NXDOMAIN, Lemlist's pre-send verification (Reoon) will catch and drop them automatically.

| Email | Name | Domain issue | Bounce Date |
|---|---|---|---|
| andrew@money-kyrle.co.uk | Andrew Money-Kyrle | money-kyrle.co.uk NXDOMAIN | 2024-01-15 |
| kenneth.wong@bfwh.nhs.uk | Kenneth Wong | bfwh.nhs.uk NXDOMAIN | 2024-01-12 |
| shahid.mahmood@nhsdirect.nhs.uk | Shahid Mahmood | nhsdirect.nhs.uk NXDOMAIN | 2024-01-12 |
| stuart.cobbe@clinmed.gla.ac.uk | Stuart Cobbe | clinmed.gla.ac.uk NXDOMAIN | 2024-01-15 |

Recommendation: leave in the list, let Reoon catch them at verify-time. If you want to be safe, exclude these 4 as well — adding them to the exclude file is a one-line cost.

## NHS "554 Too many hops" infrastructure bounces (NOT excluded)

In Feb 2024, the SMTP relay path went via `smtp1.e.amses.net` → `Trustwave SEG` → `trendmicro.eu` filtering, which **looped on its own scanning** and rejected with `554 5.4.0 Too many hops (26 max 25)`. This is **not** a recipient-side problem — the mailbox exists. Affected (verified from full message bodies):

- `antonis.pavlidis@guysandstthomas.nhs.uk` — Antonis Pavlidis (GSTT)
- `natali.chung@guysandstthomas.nhs.uk` — Natali Chung (GSTT)
- `yaso.emmanuel@guysandstthomas.nhs.uk` — Yaso Emmanuel (GSTT)
- `robert.greenbaum@londonambulance.nhs.uk` — Robert Greenbaum (London Ambulance)
- Plus several others with the same Exchange.Postmaster@gstt.nhs.uk signature

These were sent via the same relay; a Lemlist send via warmed accounts uses a totally different SMTP path and will not loop. **Keep these in the campaign.**

## Send-as misconfig (NOT excluded; ~218 cardiologists)

On 2024-01-23 and 2024-01-24 Kobi sent a batch from `kobi@kobestarr.io` using the Gmail "Send mail as" feature with a misconfigured SMTP — Gmail rejected the outbound at the sending side ("Send mail as account misconfigured"). The recipients **never even received the SMTP attempt**, so these are not recipient-side bounces. Not relevant to the exclusion list.

## Anomalies

- Many bounces in the Jan–Mar 2024 window are from a **parallel campaign** (the "funded startups" SEO/writer pitch sent in March 2024) — those have zero cardiologist overlap and are excluded by the cross-reference step.
- The campaign was concentrated on **2024-01-12, 2024-01-15, 2024-01-23, 2024-01-24, 2024-02-08, 2024-02-19, 2024-02-27** — these dates explain bounce clustering.
- The hardcoded exclude `j.grapsa@rbht.nhs.uk` was a **GDPR opt-out reply**, not a bounce — it wouldn't appear in this analysis anyway.

## Files

- `/tmp/cardiologist-bounce-exclusions.txt` — 12 emails, one per line, ready to feed into the Lemlist exclude list
- `/tmp/cardiologist-bounce-report.md` — this report
- `/tmp/consolidate_bounces.py` — the parsing script
