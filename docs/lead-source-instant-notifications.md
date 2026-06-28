# Instant Lead Notifications: Bark, Twine, LinkedIn

**Created:** 2026-06-10 · Findings from live Gmail audit + platform research

## What the audit found (Gmail, June 2026)

1. **The Bark Zapier automation is DEAD and has been since at least 20 May.**
   A Zap named "Bark lead Scheduler - ON (7 am)" fails every morning at 05:00 with:
   *"Unable to turn Zap on: You are using an older version of the 'WebHookAPI' app that cannot be used anymore."*
   Zapier has emailed an alert every single day (all unread). Any Bark lead flow downstream of that scheduler has been off for 3+ weeks.
   Fix location: [Zap editor 265498008](https://zapier.com/editor/265498008/published) (requires Kobi's Zapier login; replace the deprecated WebHookAPI step with the current Zapier Manager "Turn Zap On/Off" action, or just leave the lead Zap permanently ON and delete the scheduler).

2. **Twine job alerts already arrive in near-real-time** from `no-reply@twinehq.com`, several per day, matched to profile roles. Subjects carry role + title; bodies carry budget and urgency (e.g. 8 June: *"expert web developer needed for a £1500 job. Webflow Developer for Cosmetic Dentist Portfolio"*, still unread). No public Twine API or RSS exists; the emails ARE the feed.

3. **LinkedIn streams, with an important split:**
   - Lead-gen form fills ("Form - AI Value Accelerator", "Form - CMO Clarity Framework", "Form - Smart Content Supply Chain", "Form - Agentforce 7 lessons") from `messages-noreply@linkedin.com` are **Bluprintx (BPX) client campaigns, NOT Kobi's own pipeline** (confirmed by Kobi 2026-06-10). They belong to client delivery, not this revenue plan.
   - LinkedIn Services Marketplace leads ("Kobi, a new lead is available in London / West Midlands...") from `notifications-noreply@linkedin.com` look like Kobi's own profile; worth confirming and triaging the UK ones.

   The streams share one Gmail label and sit unread for days. **The bottleneck is not notification speed, it is response.** A £1,500 Twine job notified on Sunday and untouched on Wednesday is a dead lead; marketplace leads decay in hours.

## Do we need to reverse-engineer the APIs?

**Bark: no.** Bark ships an official [Zapier integration](https://zapier.com/apps/bark/integrations) with a "New Bark (lead)" trigger, which is exactly the instant-notification primitive. The broken Zap proves the account already has it wired. Also: the Bark Seller mobile app gives native push for free. Reverse-engineering the seller-dashboard XHR (session-cookie polling) is possible but fragile (Cloudflare, cookie expiry) and only worth it later if we want full lead payloads pulled straight into `businesses.db`.

**Twine: there is no API to reverse-engineer**, and the dashboard-polling alternative has the same cookie-fragility. But the email alerts arrive within minutes of posting and contain everything needed (role, title, budget, urgency, link). Parsing the email IS the API.

## Recommended architecture (one pipe, three sources)

```
Bark Zap (official trigger) ─────┐
Twine emails (no-reply@twinehq.com) ──┤→ parser → [filter: UK, budget≥£500,
LinkedIn Services Marketplace only ──┘    web/SEO/podcast/marketing roles]
(BPX form fills route to BPX client workflow, not here)
                                            ├→ WhatsApp to Kobi (clawdbot bridge, instant)
                                            ├→ GHL pipeline stage "New lead" (CRM + SLA timer)
                                            └→ businesses.db log (dedup, source attribution)
```

**Kobi does not pay for Zapier (the existing Bark Zap is on a free/expired plan and is the broken one). So the design is Zapier-free.**

What's built and what's left:

- **Twine: DONE (free, no Zapier).** `twine-watcher.js` polls the role listing pages, reads the briefs straight out of `window.__data` (Twine's own server-rendered Redux state: budget, currency, location, remote flag, role, posted time, hire-intent answers, URL), dedups against a state file, scores each new brief (UK +2, budget≥£400 +2, ≥£1,500 +3, urgent +1, "ready to make a paid hire" +2) and WhatsApps the score≥2 ones to Kobi via the clawdbot bridge. Deployed to clawdbot, seeded. **Only remaining step is enabling the 15-min cron (needs Kobi's OK, blocked by host-persistence guard).**
- **Bark: no API, no lead emails currently arriving.** The leads used to flow through the now-dead Zap. Two free paths: (1) the **Bark Seller mobile app** gives native push instantly, zero setup, do this first; (2) turn ON Bark's own email lead notifications in account settings, then a Gmail-API watcher (same shape as the Twine one) can parse them to WhatsApp/GHL. The Gmail watcher needs a one-time Google OAuth credential from Kobi.
- **LinkedIn Services Marketplace** (Kobi's own, not the BPX form fills): same Gmail-watcher path once OAuth is set up; filter to `notifications-noreply@linkedin.com` + UK.

The response SLA matters more than the plumbing: marketplace leads convert on first-responder speed.

## Action list
1. **Kobi (5 min):** open [the failing Zap](https://zapier.com/editor/265498008/published), fix or delete the scheduler step, confirm the underlying Bark lead Zap is ON. Check whether Bark native lead emails go to a different address (none found in kobi@kobestarr.io).
2. **Kobi (10 min):** install the Bark Seller app for native push as belt-and-braces.
3. **Build (1 hr):** the three Gmail-trigger Zaps (or give the green light for the self-hosted watcher and provide Gmail OAuth creds).
4. **Triage backlog today:** the unread Twine jobs and any UK Services Marketplace leads. (The LinkedIn form fills are BPX client leads; handle them inside the BPX engagement, where unresponded leads are a client-delivery risk rather than a Kobi-pipeline one.)
5. **GHL:** create one "Inbound marketplace leads" pipeline with stages New → Responded → Quoted → Won/Lost, and wire all sources into it. This is also the GHL use-case that justifies the £300/mo.
