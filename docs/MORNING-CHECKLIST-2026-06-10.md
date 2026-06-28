# Morning checklist — what I did overnight, what needs you

**Left for you by Claude, ~03:30, 2026-06-10.** Everything below is either done and waiting for your go, or a 5-minute job only you can do (login / OAuth / billing decisions).

## ✅ Done while you slept

1. **Twine instant-lead watcher, built and live on clawdbot.** Free, no Zapier. It reads Twine's own page data (budget, location, role, urgency, "ready to hire" signal) and WhatsApps you the good UK / high-budget jobs the moment they post. You should already have a test WhatsApp from it. Code: `twine-watcher.js`. It's seeded (knows the 97 jobs currently live, so it won't spam you with the backlog).
2. **Pilot lead list exported and cleaned:** 85 genuine NW accountancy + law firms ready to contact (`exports/pilot-ksd-pro-services-nw-2026-06-10.csv`).
3. **Pilot sequence drafted** in your house voice (LinkedIn-first + email, Nigel + Twiggy, AI-visibility hook): `exports/pilot-ksd-pro-services-sequence.md`.
4. **Three planning docs updated:** the £30k plan, the lead-notifications architecture, and this checklist.

## ⚠️ Important thing I found — read this

The 4,134 "good" Consulti leads are **not all local firms.** About half are genuine practices (Zen Law, Alexander & Co Chartered Accountants); the other half are **individuals who happen to hold a finance/legal job at a big company** (Sainsbury's, Dentsu, Regatta, City Football Group, BAE Systems). The "your firm is invisible to AI" pitch only works on the real firms. I filtered those out for the pilot, but **before the big scale-send we need to run the same firm-vs-individual filter across the whole campaign**, or half the sends will land wrong. This is a good thing to have caught now rather than after burning the list.

## 🔲 Your 5-minute jobs (in priority order)

1. **Turn on the Twine watcher schedule.** I built and tested it but the auto-mode guard blocked me from installing a standing cron job on clawdbot without your say-so. To switch it to every-15-minutes, SSH in and run:
   ```bash
   ssh clawdbot
   ( crontab -l 2>/dev/null; echo "*/15 * * * * /usr/bin/node /root/twine-watcher.js >> /root/data/twine-watcher.log 2>&1" ) | crontab -
   crontab -l   # confirm it's there
   ```
   (Or just tell me "yes, schedule it" and I'll do it.)

2. **Fix the dead Bark Zap (or replace it).** Your "Bark lead Scheduler" Zap has failed every morning since 20 May (deprecated Zapier app), so Bark leads haven't been flowing. Fastest free fix that doesn't need Zapier at all: **install the Bark Seller app on your phone for native push**, and in Bark account settings **turn on email lead notifications**. Once those emails arrive I can build a Gmail watcher (same as the Twine one) to route them to WhatsApp + GHL.

3. **Give me Gmail API access (one-time).** That unlocks the Bark-email and LinkedIn-Services-Marketplace watchers. Without it I can read your inbox through the connected Gmail tool but can't run an unattended poller. Your call whether to set up a Google OAuth credential or just rely on the Bark app push.

4. **Approve the pilot subjects.** The sequence has 4 subject-line options marked "for audit". Per your own rule nothing sends without a cold-reader pass. Pick/redraft and I'll finalise, then we load Prosp + email.

## 🔲 Bigger decisions (when you have a coffee, not 5 min)
- Doctify compliance posture (unlocks 42,400 medical leads, the highest-ticket cold lane).
- Funded-founders price points (build £, retrofit £, Authority Engine £/mo).
- Whether to run the whole 4,134 through the firm-filter + Reoon this week for the scale-send.

## Where everything lives
- £30k plan: `docs/revenue-30k-plan-2026-06.md`
- Lead notifications architecture: `docs/lead-source-instant-notifications.md`
- Pilot list + copy: `exports/pilot-ksd-pro-services-*`
- Twine watcher: `twine-watcher.js` (local copy) + `/root/twine-watcher.js` on clawdbot
