# Morning Brief — 2026-06-29

**Goal:** arrive 9am, everything live by 10am, leads landing by Wednesday.
**Model:** email = volume (fire today), Prosp connect = premium lane (set up today), Kondo = warm/free leads already in the inbox.

---

## What's built and waiting (done overnight)
- **816 safe KSD leads** verified + split, Mailead-ready: `exports/ksd-proservices-batch2-2026-06-24-safe816.csv`
- **Funded A/B/C** assembled (52/130/5), subjects cold-reader audited, names naturalised
- **Prosp connect machine** (code done + tested): loader, specific cold reason-for-connecting branch, cap 20/day, voice scripts
- **Kondo** connected, re-engagement list pulled (below)
- **linkedapi reaction runner** scaffold ready (awaiting your identification-token)

---

## 9:00 — SEND THE EMAILS (volume, ~30 min, do this first)
The 816 safe KSD accountants/solicitors via Mailead (no API, manual load):
1. Mailead → campaign `KSD · AI Search · Professional Services` (append, same identity as the 81)
2. Upload `ksd-proservices-batch2-2026-06-24-safe816.csv`
3. **Map columns:** first_name → First Name, **`company` → Company Name** (not `{{company}}` or it renders blank), category/town → custom vars
4. Subject (locked): `AI search for {{company_name}} {{first_name}}`; sequence = the 4-email KSD sequence
5. Sending: 9 KSD boxes, 8-10/box/day, **first touch Mon-Thu** (today qualifies)
6. Launch.
7. **Reply capture check:** confirm the 9 KSD boxes forward → Gmail so the reply-watcher catches replies.

> Then optionally queue the catch_all/unknown 346 behind the safe-816 at lower volume.

## 9:30 — PROSP CONNECT PILOT (premium lane: Funded Route A, 52)
**Your 3 setup steps (the only blockers):**
1. `cd linkedin-content-intel && npm install better-sqlite3`
2. In Prosp, create one **dealflow** container campaign + list → put the IDs in `kobestarr-tools/.env` as `PROSP_CAMPAIGN_ID_DEALFLOW` and `PROSP_LIST_ID_DEALFLOW`
3. Record the voice notes from `docs/prosp-voice-scripts-2026-06-28.md` (or set up the AI clone)

**Then I run:**
```
node src/load-cold-leads.js ".../exports/funded-mailead-A-buildled-2026-06-28.csv" --client=dealflow --post-id=cold-funded-a-2026-06 --go
node src/outreach-runner.js --dry-run     # review the burst
node src/outreach-runner.js               # live, 20 connects/day
```
Protocol per lead: no-note connect → localised greeting → branch → name "oops" → **specific** site/AI reason → voice memo → you take over in Kondo on reply.

## 9:45 — KONDO RE-ENGAGEMENT (warm, free)
**🚨 First: Lemya Soltani** — paying podcast-guesting client, "last payment failed, can you look into it?" Fix the billing, it's live revenue.

Drafts already saved (just hit send):
1. **Jerry Pett** — empathy reply sent; watch for his response
2. **Mark Nickerson** — podcast on hold for sponsors; draft offers guesting to build audience first
3. **Erin Green** — went warm ("opening up time-wise"); draft proposes a call
4. **Chris Willingham** — nudge the Brompton podcast-show pitch (you make Specialized's Cycling Show — that's the angle)
5. **Robson Martinho** — light Portuguese follow-up
6. Skip the pleasantries (Manoj, Nima, Alicia, Rachel, Morgan)

### Connect-requests worth accepting + an "offer just for you" message (say go, I'll draft each)
- **Teodor Genov** — "admire your work turning founders into podcast authorities" (perfect)
- **Krystal Parker** — podcast host/author/CEO (Stripped fit)
- **Neil Adams** — exited agency founder (46 mutuals)
- **Curtis Maughan** — Founder @ Stillwater
- **Lubaba** — Co-Founder, Affanium Chocolate (consumer → Stripped)
- B2B: Ahmad Zain, Jeff Cleasby, Abbie Poots (65 mutuals), Hania Szymczak

### LinkedIn reactions: LIVE-READY
linkedapi token stored, auth complete. I dry-run first, then warm ICPs with reactions (Prosp owns connects, this owns reactions).

---

## By 10am: all guns blazing
- Emails dripping (816 KSD)
- Connects dripping (52 Funded Route A)
- Kondo warm leads in motion

## Wednesday: leads
Email opens/replies land (Day 0 today), connect acceptances trigger the bursts, reply-watcher + Kondo catch everything.

## 1 July pivot (locked)
Fresh LeadByte/funded drop lands ~1 July and **takes priority** (newest sends first). Today's funded Route A is the **protocol pilot** to prove the machine before the July volume arrives.

## Still pending from you (besides the 3 setup steps)
- linkedapi **identification-token** (from app.linkedapi.io) → I switch on ICP reactions
- Create the `kobestarr` + `stripped` Prosp campaigns when ready (KSD-connect + funded-podcast lanes)

---

*All overnight code is captured by the autosave net; ask me to commit it properly when you're up.*
