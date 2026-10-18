---
name: mailead-campaign-builder
description: Use when creating, configuring, loading leads into, fixing, or preparing to launch a Mailead (app.mailead.io) cold-email campaign, or when Mailead UI changes do not save, lead counts look wrong, the Contacts tab is empty, or sender mailboxes, wait days or schedule revert after reload.
---

# Mailead campaign builder

## Overview
The Mailead **API** (personal key) can only list campaigns, add leads and remove leads. Everything else (create, emails, schedule, senders, launch) is **UI only**, via Claude in Chrome. Many UI fields look set but do not persist unless changed the one way that works. Reload and verify every field. **Kobi launches; Claude never does.**

## Order of work
1. Lead file ready and checked (see Leads).
2. UI build (steps A to F), leave as **Draft**.
3. Register in `config/campaign-sheets.json`, make the tracking sheet, load leads by API.
4. Register reply + bounce webhooks for the new campaign id: `M.req('create_webhook', {body:{campaign_id, enabled_events:['email_answered'], url: receiver}})`, then the same for `email_bounced`; ids live in `config/mailead-webhooks.json`. The URL there has a placeholder that reads `<secret on VPS unit + scratchpad>` (replace with the regex `/<secret[^>]*>/`, never a literal `<secret>` match): build the real one by replacing it with HOOK_SECRET from the VPS (`ssh clawdbot "systemctl cat mailead-webhook"`), never register the placeholder and never commit the secret. Test with a POST to the real URL and STOP unless it returns 200, before creating any webhook (18 Oct: six were registered against a 404 because the placeholder was not substituted). The create response puts the id at `data.webhook.id`. Without webhooks replies never reach Buzz ~outreach and bounces are never removed. There is no list-webhooks endpoint, so record every id you create.
5. Reconcile the count, then hand Kobi the launch checklist.

## UI methods that persist (verified 2026-10-15; re-verify if a step reverts)
- **A. Create:** Campaigns, New Campaign, type name (must be unique), Continue.
- **B. Emails:** Email Sequence, Create Manually. Click Subject, type. Click body, `type` the email with `\n\n` between paragraphs. Add step, click the new step card, click body, type. Follow-up subjects copy step 1 (same thread).
- **C. Wait days:** each step's "Days to wait before next message" = gap AFTER that step. Day 0/3/7/14 = step1 3, step2 4, step3 7 (last step blank). ONLY the small up/down arrows commit; typing, `form_input` and JS revert.
- **D. Schedule:** click day checkboxes (first touch never Friday: Mon to Thu), Save, wait for "Schedule Saved". Leave hours at default 9am to 5pm: the hour dropdowns and timezone picker do not persist or open. Picker is labelled "UTC +2 CEST" (UK+1 in summer); after the clocks change (25 Oct 2026) check whether it is now UK+2.
- **E. Senders:** Settings & Sending, click the email-account search box, type ONE full address, press Return; repeat; then Save. Mouse clicks and jQuery `.val()` do not persist. **Senders only stick if Launch is clicked in the same page session**: after a reload they can show 0 again. So add senders last, then hand Kobi the tab to launch without reloading; if he launches later, re-add them first.
- **F. Text-only:** tick "Send emails as text-only (no HTML)" (turns both trackers off), Save. Never click Launch Campaign.
- **Reload and check:** emails, waits, days, "Emails Account Connected" = expected number.

## Sender sets (one brand per campaign)
| Brand | Addresses |
|---|---|
| KSD (local, pro services) | kobi@, kobi.o@, kobi.omenaka@ each at kobestarrdigital.com, kobestarr.digital, trykobestarrdigital.com (9) |
| Stripped Media | kobi@, kobi.o@, kobi.omenaka@ each at strippedmedia.co.uk, strippedmedia.org, gostripped.media |
| Dealflow Media | kobi@, kobi.o@, kobi.omenaka@ each at dealflowmedia.co, dealflowmedia.pro, dealflowmedia.group |

## Leads
- Checks before loading:
  - drop already-contacted firms: `businesses.db` (`campaigns`, `exported_to`), `data/sent-ledger.txt`, `data/mailead-loaded-*.txt`; match exact email or own domain, never gmail/hotmail-style domains
  - verify by list type: funded/startup = Reoon safe only; UK local/professional may keep risky
  - for "see who comes up" pitches, run `node check-ai-visibility.js <send.csv>` and hold back firms already near the top
- Register: `mailead.campaignId`, sequence path, route rule, carriers.
- Tracking sheet: create with the Google Drive connector (the service account cannot create sheets), share Editor with `outreach-sheets@kobestarr-leadpipe.iam.gserviceaccount.com`, add tab `ToSend` with the service account (Sheets `batchUpdate addSheet`).
- Load: `node send-batch.js <csv> --campaign <key> --dry-run`, then without `--dry-run`; then `node load-to-mailead.js --campaign <key> --title "<exact title>" --dry-run`, then live. Titles must be unique (`resolveCampaignId` refuses twins).
- **Loading into an Active campaign starts sending immediately.** Load only into Drafts unless Kobi says otherwise.
- After any FAIL or timeout, do not re-run blindly: Mailead does not dedupe, and a timed-out add may have landed.

## Reconcile
Draft campaigns show nothing in Contacts. After up to 15 min, the campaign list's Leads column must equal the lines in that campaign's `data/mailead-loaded-<id>-*.txt` ledger. Wait out the lag before acting.

## Fixing a wrong count
`remove_lead` returns "removed successfully" even when nothing changes; never remove-and-re-add or test-add a real lead. Instead:
1. Rename the old campaign "OLD DO NOT LAUNCH ...".
2. ⋮ Duplicate it. The copy keeps emails and waits but drops days, senders and text-only, so redo D to F.
3. Update `mailead.campaignId` in the registry.
4. Load the exact list by API with a new ledger file for the new id.
5. Do not delete the old campaign without Kobi.

## Launch checklist for Kobi
Pending (Analytics) = ledger count; "Emails Account Connected" = sender count (re-add if 0, see E); webhooks registered with the real URL; then Launch Campaign in that same tab.

## Chrome keeps asking permission
Kobi runs `jq '.permissions.allow += ["mcp__claude-in-chrome"]' ~/.claude/settings.json > /tmp/s.json && mv /tmp/s.json ~/.claude/settings.json` in Terminal. Claude cannot edit its own permissions.
