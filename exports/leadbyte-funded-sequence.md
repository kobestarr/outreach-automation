# Sequence: LeadByte Funded Founders (Authority Offer)

**Campaign:** `KSD · AI Search · LeadByte Funded Founders` (tag `ksd-aisearch-leadbyte-funded`)
**Audience:** recently-funded founders from the monthly LeadByte drop, truth-checked HOT (dead/thin site or AI-invisible). Source: `process-funded-startups.js` → `exports/funded-startups-<month>-checked.csv`.
**Offer:** free AI-visibility audit (the door); authority system underneath (AI-ready site + podcast placement + AI-search optimisation). See `docs/funded-startups-authority-offer.md`.
**Fields:** STANDARD ONLY — `{{first_name}}`, `{{company_name}}`. No custom variables → rides the TaskMagic append machine natively.
**Cadence:** Email 1 Day 0 → Email 2 Day 3 → Email 3 Day 6 → Email 4 Day 12. Subjects blank after E1 (same thread). Mon-Fri window, first email never Friday.
**Voice (Kobi's final, chosen 2026-06-25):** personal, hand-typed, "Sent from my iPhone" sig. Podcast/roundtable moat kept in E1 (Kobi's call). Audit framed as ALREADY PREPARED across all four.

> ⚠️ **HARD DEPENDENCY:** every email claims the audit is already prepared. A "yes" reply (from any of the 4) needs a real per-company audit ready within the hour. **The audit-generator must be built before first replies land** (raw data exists in `funded-startups-<month>-checked.csv`: aiScore, siteStatus, signals).

---

## Email 1 — Day 0

**Subject:** `AI search for {{company_name}} {{first_name}}`

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

## Email 2 — Day 3 (blank subject / same thread)

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

## Email 3 — Day 6 (the real pitch; same thread)

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

## Email 4 — Day 12 (breakup; same thread)

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

## Notes
- Audit = auto-generated per company from `funded-startups-<month>-checked.csv` (aiScore, siteStatus, missing schema/content, queries they don't rank for). **Build the generator — copy promises it 4x.**
- Bucket (kobestarr / dealflow) decides the *post-reply* pitch (build vs podcast), not separate campaigns.
- Subjects: only E1 has one; E2-4 blank to thread. Subject reuses the proven KSD pattern.
- Sig inconsistency to resolve: E3/E4 stack "Kobestarr Digital" + "Sent from my iPhone" — pick one per email for the hand-typed illusion.
