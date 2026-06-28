# SOP — Mailead + TaskMagic Sending (create & run, every batch)

**Owner:** Kobi · **Created:** 2026-06-21 · **Supersedes nothing** (companion to `mailead-taskmagic-sending-playbook.md` which holds the *why*; this is the *how*, step by step).

This is the repeatable operating procedure for every outreach batch. Two hard constraints from Mailead shape everything below:
- **No Zapier / no public API.** TaskMagic (same founder, free inside a Mailead flow) is the only automation layer.
- **Re-uploading a CSV to an existing campaign DELETES the previous leads.** So: **one campaign per batch, never re-upload to append.**

---

## Golden rules (read once, never break)

1. **One campaign = one batch.** Name it `ksd-<segment>-<YYYY-MM-DD>`. Never re-upload into a live campaign.
2. **Headers match merge tags exactly.** The CSV column names ARE the merge variables. Copy uses `{{first_name}} {{company}} {{category}} {{town}}` → the CSV must have those exact headers (not `location`, not `Company`).
3. **Verify before load.** Website-scraped emails = auto-valid; everything else goes through Reoon (2,100/day) first. Never load unverified.
4. **Right boxes for the right identity.** 27 Mailead boxes total = 9 DealFlow + 9 Stripped + 9 Kobestarr Digital. AI-visibility / local pro-services pitch → **9 KSD boxes only**. Funded-founders / podcast-authority → DealFlow/Stripped. `kobestarr.io` is Lemlist-only, never Mailead.
5. **Gentle ramp.** ~10 emails/box/day to start. 9 boxes ≈ 90/day. Don't blast a cold domain.
6. **Tue–Thu sends only.** No Mon (weekend backlog) or Fri (ignored).
7. **Subject = cold-reader audited.** No subject ships on vibes. Personalise with `{{company}}` where possible.
8. **Dry-run / spot-check the merge.** Before launch, preview 3 rows in Mailead and confirm no `{{blank}}` tags render.

---

## Part A — Prepare the list (DB → Mailead-ready CSV)

1. Export the verified, firm-filtered leads from the DB for the segment.
2. Run the field-normalise step so headers match the copy's merge tags. Required columns, in this order:
   `first_name, email, company, category, town, linkedin_url, website`
   (rename `location` → `town`; ensure `category` is the human word used in copy, e.g. `accountant`/`solicitor`.)
3. Validate before saving (the build script must report **0 issues**):
   - 0 blank `email`, 0 blank `first_name`
   - `first_name` starts with a letter (no `Info`, `Contact`, `Team`, `The`)
   - `town` present, `category` in the allowed set
4. Save as `exports/<segment>-mailead-<YYYY-MM-DD>.csv`. This same file feeds Prosp (it carries `linkedin_url`).

> Reference build: `exports/pilot-mailead-2026-06-16.csv` was produced this way (81 firms, 0 issues).

---

## Part B — Load & launch in Mailead (manual, ~15 min)

Do this manually for any batch under ~250 — it's faster than automating, zero moving parts.

1. **Campaigns → New campaign.** Name `ksd-<segment>-<YYYY-MM-DD>`.
2. **Upload leads** → select the Part-A CSV. Confirm field mapping auto-matches (headers = tags). Fix any unmapped column.
3. **Paste the sequence** (4 emails) from the segment's sequence doc. Set delays: Day 0 / 3 / 6 / 12. Emails 2–4 = reply on same thread, **blank subject**.
4. **Subject (email 1):** paste the cold-reader-approved line. Personalise with `{{company}}`.
5. **Select sending mailboxes:** the 9 KSD boxes (or segment-correct set). Confirm each shows healthy deliverability (91–99).
6. **Sending schedule:** Europe/London business hours, **Tue–Thu**, ~10/box/day.
7. **Preview 3 leads** → confirm every merge tag renders (no empty `{{ }}`). 
8. **Launch.**
9. **Fire Prosp LinkedIn no-note connects** from the same CSV the **same morning** so the touches reinforce.

---

## Part C — TaskMagic Cloud automation (build once, use from batch 2+)

Only worth it for recurring/larger batches. Runs unattended on Cloud (tier 5 = **6 hrs/month**, shared across all automations — minutes per lead-load run, so plenty; keep heavy scraping OFF it).

**Setup (one time):**
- Make sure your **TaskMagic account email == your Mailead account email** so the integration links.
- Staging Google Sheet with a `ToSend` tab, columns identical to the Part-A CSV.

**Build the flow (TaskMagic builds from a plain-English description, then you approve steps):**
> "When I add rows to the Google Sheet tab 'ToSend', take those leads and add them to a NEW campaign in Mailead named with today's date, mapping columns first_name, email, company, category, town to the campaign's lead fields. Then notify me on WhatsApp that the campaign is built with the lead count."

**Rules for the flow:**
- Prefer TaskMagic's **Mailead app-action** for the add-to-campaign step (reliable). Use browser automation only as fallback — long UI runs are reported flaky.
- Run **on-demand per batch** (or scheduled weekly), NOT an always-on poller — saves cloud hours.
- It creates a **new dated campaign every run** (respects the overwrite rule). Never point it at an existing campaign.

---

## Part D — Replies & tracking

1. Mailead senders are repointed so **replies land in normal Gmail**. Good — Mailead inbox bypassed.
2. Gmail label `KSD-Outreach-Replies` + filter on the campaign sending addresses, so replies are visible at a glance.
3. **Same-day response habit.** Goal of every reply = **booked call**, not closing in-thread.
4. Mirror into the **Kobestarr Digital GHL subaccount** once it's wired (currently the connected one is Flixwatcher). `reply-watcher.py` + `ghl-router.js` are the build for this.

---

## Quick checklist (print this)

- [ ] Leads verified (Reoon for non-website emails)
- [ ] CSV headers = merge tags, 0 validation issues
- [ ] New dated campaign (never re-upload)
- [ ] Correct identity mailboxes (KSD for pro-services)
- [ ] Subject cold-reader approved + personalised
- [ ] 3-row merge preview clean
- [ ] Schedule Tue–Thu, ~10/box/day
- [ ] Prosp LI connects same morning
- [ ] Gmail label live for replies

---

## Sources / linked docs
- Why-it-works + vendor research: `docs/mailead-taskmagic-sending-playbook.md`
- Segment copy: `exports/pilot-ksd-pro-services-sequence.md`
- Go-live decisions (locked 2026-06-12): `docs/monday-go-live-pack.md`
