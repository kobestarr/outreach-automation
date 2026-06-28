# Funded Startups (May 2026 drop) — 3 send sequences

**Source:** `exports/funded-startups-2026-05-warm.csv` (Reoon-verified warm pool) + `-other.csv` (slow drip).
**Base voice:** the approved `exports/leadbyte-funded-sequence.md` (locked 2026-06-25). Same rules: no dashes, warm hand-typed, standard fields only (`{{first_name}}`, `{{company_name}}`), audit framed as already prepared, soft CTA, "Sent from my iPhone".
**Cadence:** E1 Day 0 → E2 Day 3 → E3 Day 6 → E4 Day 12. Subjects blank after E1 (same thread). Mon-Fri, first email never Friday. Warm pool normal cadence; "other" pool slower drip.
**Subjects below are DRAFT — none ship without a cold-reader audit ([[feedback-subject-lines-cold-reader]]).**

> ⚠️ **HARD DEPENDENCY (carried from the base):** every sequence implies an audit is ready. A "yes" from any email needs a real per-company audit within the hour. The **audit-generator must exist before first replies land**. Raw data is in `funded-startups-2026-05-checked.csv` (`aiScore`, `siteStatus`, `signals`). If it is not built, soften E1 to "I can pull together a quick audit" (future tense) instead of "I've prepared".

## Routing (which sequence each lead gets) — by data column, not just bucket
| Sequence | Route on | Lead component | Approx pool |
|---|---|---|---|
| **A · Build-led** | `siteStatus` in {dead, parked, thin, http4xx, http5xx} | Kobestarr Digital site build | the broken-site HOT leads |
| **B · AI-search-led** | site OK but `aiInvisible=true` | AI-search visibility | the live-but-invisible leads |
| **C · Podcast-led** | `bucket=stripped` (media) or clear founder-fit | Dealflow Media + podcast placement | the 37 media + founder-fit |

Everyone gets the authority system underneath; the lead is just the easiest first yes.

---

## Sequence A — Build-led (broken / thin / down site)

### A1 — Day 0
**Subject (draft):** `quick one about {{company_name}}'s site, {{first_name}}`

> Hi {{first_name}},
>
> Saw the raise, congrats. I went to take a look at {{company_name}} and the site either isn't loading properly or there's barely anything there yet, which is a shame because right now it's the first thing a buyer or investor checks after they hear about you.
>
> Sorting that is the bread and butter of what I do. Most recently for Dr Nigel Stephens and Twiggy (yes, that Twiggy). Nigel's words were that he wanted to control how people saw him when they compared him to others in his field, and that's really the whole game.
>
> I build them fast, beautiful, and so that AI tools like ChatGPT actually cite you when people ask. I've already pulled together a quick audit for {{company_name}} showing what I'd fix first. Want to see it? No strings.
>
> Cheers,
> Kobi
>
> Sent from my iPhone

### A2 — Day 3 (blank subject, same thread)
> Hey {{first_name}},
>
> Just nudging this up your inbox in case it got buried.
>
> Short version: the site is the one thing every buyer, hire and investor checks, and {{company_name}}'s isn't pulling its weight yet. Much cheaper to get right now than to redo it in a year.
>
> The audit I prepared shows exactly where I'd start. Want it?
>
> Cheers,
> Kobi
>
> Sent from my iPhone

### A3 — Day 6 (same thread)
> Hi {{first_name}},
>
> Last proper one from me, promise.
>
> This is genuinely what I do for a living. Alongside the build I co-chair the UK Podcast Roundtable and run Dealflow Media, so for the right founders I can also get you in front of the audiences that build real category authority (which is also what the AI engines start citing).
>
> For {{company_name}} I've got a quick audit ready showing the three things I'd fix first. Want it?
>
> Cheers,
> Kobi
>
> Sent from my iPhone

### A4 — Day 12 (breakup, same thread)
> Hi {{first_name}},
>
> I'll leave you in peace after this one.
>
> If getting {{company_name}} a site that actually works for you (and gets found in AI search) is ever worth a look, just reply "audit" and I'll sort it. If not, no worries at all.
>
> Either way, congrats again on the raise and all the best growing the thing 😃
>
> Cheers,
> Kobi
> Kobestarr Digital
>
> Sent from my iPhone

---

## Sequence B — AI-search-led (site is fine, but invisible to AI)

This is the approved `leadbyte-funded-sequence.md` base, reused verbatim for consistency.

### B1 — Day 0
**Subject (cold-reader audited 2026-06-28):** `{{company_name}} isn't showing up in AI search, {{first_name}}`
*(Replaced draft `AI search for {{company_name}} {{first_name}}` — that jammed company+name with no comma and collided on AI-named firms e.g. "AI search for Atheni AI". A/B alt: `found {{company_name}} but ChatGPT hadn't, {{first_name}}`.)*

> Hi {{first_name}},
>
> I saw the raise, congrats. I had a quick look and {{company_name}} doesn't really come up when people ask AI tools like ChatGPT or Google's AI for companies in your space. That's where a lot of buyers (and investors) start now, before they ever land on your site.
>
> It's all pretty fixable.
>
> This is what I do for funded founders. I can also get the right ones in front of the right podcast audiences. I co-chair the UK Podcast Roundtable and run Dealflow Media, which is usually where the authority compounds.
>
> I've taken the time to prepare an AI visibility audit for you guys. It shows exactly where {{company_name}} is invisible to AI and the three things I'd fix first. Do you want to see it? No strings.
>
> Cheers,
> Kobi
>
> Sent from my iPhone

### B2 — Day 3 (blank subject, same thread)
> Hey {{first_name}},
>
> Just bumping this up your inbox in case it got buried.
>
> Quick version: your buyers are increasingly asking AI "who are the best companies for X", and right now the answer doesn't include {{company_name}}. Much easier to fix while you're early than to play catch-up once a competitor owns that answer.
>
> I've prepared an audit showing where {{company_name}} stands today. Do you want to see it?
>
> Cheers,
> Kobi
>
> Sent from my iPhone

### B3 — Day 6 (same thread)
> Hi {{first_name}},
>
> Last proper one from me on this, promise.
>
> This is what I do for a living. Alongside the AI-search side, I co-chair the UK Podcast Roundtable and run Dealflow Media, so for the right founders I can also get you in front of the shows and audiences that actually build category authority (which, conveniently, is also what the AI engines start citing).
>
> For {{company_name}} I've pulled together a quick audit showing exactly where you're invisible in AI search and the three things I'd fix first.
>
> Want it?
>
> Cheers,
> Kobi
>
> Sent from my iPhone

### B4 — Day 12 (breakup, same thread)
> Hi {{first_name}},
>
> I'll leave you in peace after this one.
>
> If getting {{company_name}} found in AI search (and in front of the right audiences) is ever worth a look, just reply "audit" and I'll sort it. If not, no worries at all.
>
> Either way, congrats again on the raise and all the best with the build and growing your empire 😃
>
> Cheers,
> Kobi
> Kobestarr Digital
>
> Sent from my iPhone

---

## Sequence C — Podcast-led (media / entertainment / founder-fit)

### C1 — Day 0
**Subject (draft):** `{{company_name}} on the right shows, {{first_name}}`

> Hi {{first_name}},
>
> Saw the raise, congrats. I work in the audio and media world, I co-chair the UK Podcast Roundtable and run Dealflow Media, so when I saw what {{company_name}} is building my first thought was that you should be on the right shows talking about it, not waiting for people to find you.
>
> That's the bit most founders can't buy their way into, and it's where authority actually compounds. It also feeds straight back into how you show up in AI search, because the engines start citing the people who keep turning up in the right places.
>
> I've put together a quick audit for {{company_name}} on where you'd land best and where you're currently invisible. Want to see it? No strings.
>
> Cheers,
> Kobi
>
> Sent from my iPhone

### C2 — Day 3 (blank subject, same thread)
> Hey {{first_name}},
>
> Nudging this up in case it got buried.
>
> Short version: I can get {{company_name}} in front of the right podcast audiences and turn each appearance into content that keeps working long after. Most agencies genuinely can't offer that. I live in this industry.
>
> The audit I prepared shows where I'd start. Want it?
>
> Cheers,
> Kobi
>
> Sent from my iPhone

### C3 — Day 6 (same thread)
> Hi {{first_name}},
>
> Last proper one from me, promise.
>
> This is what I do day to day. The podcast placements, the content engine off the back of them, and the AI-search side that ties it all together. For Dr Nigel Stephens and Twiggy it's the same playbook, just their category instead of yours.
>
> For {{company_name}} I've got a quick audit ready on where you'd land and what I'd fix first. Want it?
>
> Cheers,
> Kobi
>
> Sent from my iPhone

### C4 — Day 12 (breakup, same thread)
> Hi {{first_name}},
>
> I'll leave you in peace after this one.
>
> If getting {{company_name}} in front of the right audiences (and found in AI search) is ever worth a look, just reply "audit" and I'll sort it. If not, no worries at all.
>
> Either way, congrats again on the raise and all the best with the build 😃
>
> Cheers,
> Kobi
> Dealflow Media
>
> Sent from my iPhone
