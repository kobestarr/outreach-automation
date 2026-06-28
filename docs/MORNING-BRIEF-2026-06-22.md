# Morning Brief — 2026-06-22

Overnight findings + the order to do things. Written while you slept.

## 1. Send the 81 (first thing) — ~15 min
- File ready: `exports/pilot-mailead-2026-06-16.csv` (81 firms, headers already match merge tags, 0 issues).
- New Mailead campaign `ksd-pro-nw-pilot-2026-06-22`, upload CSV, paste the 4-email sequence (`exports/pilot-ksd-pro-services-sequence.md`), 9 KSD boxes, Tue–Thu, ~10/box/day.
- **One decision:** subject. Recommend `{{company}} + ai search` over bare `ai search` (personalised, less spammy). Your call.
- Same morning: fire Prosp no-note LinkedIn connects from the same CSV.

## 2. Reply capture — ALREADY LIVE, but verify ONE thing
- The reply-watcher is **deployed and healthy on clawdbot** (cron every 15 min, last run 21 Jun 23:30, Gmail scanning fine, 0 routed = no replies yet, which is correct). Chain verified end-to-end via dry-run. All 81 are in the allowlist.
- It reads **`kobi@kobestarr.io` only**.
- **THE GAP:** Mailead sends from the 9 KSD boxes, so replies land THERE + in Mailead's unibox, not automatically in `kobi@kobestarr.io`.
  - **Action:** set forwarding on all 9 KSD sending boxes → `kobi@kobestarr.io`. Then the watcher catches every reply, auto-creates a GHL contact in the Outbound pipeline, and WhatsApps you.
  - Quick test after: send yourself an email from an outside address that's on the allowlist (or temporarily add a test address) → within 15 min you should get a WhatsApp ping. Then remove the test.
- **Unibox note:** Mailead has a unibox (you can see it) but NO public API, so it can't be read programmatically (only flaky browser automation). Use it as a manual backup, not the automation route. The forward-to-Gmail route is the reliable one.

## 2b. Allowlist is NOT dynamic yet — new tool built (`sync-allowlist.js`)
- The allowlist was a one-time snapshot. New leads don't auto-appear, so their replies would be missed.
- **Finding:** the live 6,674 allowlist is ALREADY missing **1,721 emails** that are in the DB (DB has 8,395 distinct). Those replies would be dropped right now.
- Built `sync-allowlist.js`: regenerates the allowlist from the DB (+ any CSVs) as a pure superset (0 dropped), optionally pushes to clawdbot. Dry-run verified, NOT pushed yet (your review).
- **Run in the morning:**
  - `node sync-allowlist.js --dry-run` (review the +adds)
  - `node sync-allowlist.js --push` (rewrite + scp to clawdbot; watcher picks it up next 15-min run)
  - For cardiologists: add `--csv ~/Downloads/leadrocks_cardiologists_2024_01_11.csv` (and/or the Doctify export) so their replies are caught.
- **Wire-in later:** call this at the end of the export/load step so the allowlist refreshes automatically every batch (then it IS dynamic).

## 3. Next campaign — cardiologists via Lemlist
- You flagged: doctors/specialists, start with cardiologists, send via Lemlist.
- We already have a list: **LeadRocks cardiologists 2024** (~360 contacts, `~/Downloads/leadrocks_cardiologists_2024_01_11.csv`), only ~74 ever emailed, **~285 untouched**. Pitched on Nigel Stephens. Ripe. (See memory `project-doctors-website-campaign-2024`.)
- Bigger private-medical source: **Doctify** playbook (`docs/doctify-leadgen-playbook.md`) — ~42,400 UK specialists, emails in page payload.
- **Caveat:** Consulti had 0% match on NHS cardiologists — these must be PRIVATE specialists. LeadRocks/Doctify are the right sources, not Consulti.
- **Channel:** Lemlist (your rule: kobestarr.io = Lemlist, not Mailead). Cardiologist replies to kobi@kobestarr.io are caught by the same watcher automatically (they're a different allowlist segment but same inbox).
- Plan to build in the morning: verify the 285 untouched (Reoon), write a cardiologist-specific sequence (Nigel Stephens as the proof, same AI-search wedge), load to Lemlist.

## State of play (the stack, end to end)
- **Send:** Mailead (cold email, 9 KSD boxes) + Lemlist (kobestarr.io, press/medical) + Prosp (LinkedIn).
- **Stage:** Google Sheet `ToSend` → TaskMagic → Mailead (append via app-action, NOT CSV re-upload). Needs the 2-lead append test.
- **Track/automate:** GoHighLevel via the full-bore CLI (NOT the weak official MCP). `ghl-router.js` + reply-watcher do Send→Track→Notify, live on clawdbot.
- **Newsletter (later):** WP landing page + embedded GHL form (JS embed), opt-in only. Email 4 breakup offers it.

## The two things that actually unlock revenue today
1. Send the 81.
2. Set the 9-box → Gmail forwarding so warm replies reach you instantly.
