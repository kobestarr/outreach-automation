# Kobestarr Digital — Authority Offer for Funded Founders

**Created 2026-06.** Target: recently-funded founders from the monthly "1K - Current Month"
list, truth-checked for real website need + AI-search invisibility
(see `process-funded-startups.js` → `exports/funded-startups-<month>-checked.csv`,
and [[project-funded-startups-monthly]]).

## Positioning (the one line)
**"We make funded founders the recognised authority in their category — visible to their
buyers, to AI, and to the market."**
Sell AI-search visibility and authority, NOT "a website." The website is where it lands.

## The flywheel (why the parts are one machine, not three services)
Podcast appearance → transcript + clips + show notes + articles → personal-brand content →
authority signals across the web → AI answer engines start citing them → inbound pipeline.
Each turn compounds. AI search is the through-line that ties every component together.

## Four components, one outcome
1. **AI-ready website** — fast, beautiful, built to be cited (schema, clean structure). *Kobestarr Digital*
2. **Podcast** — host them on a Dealflow Media show (warm, we control it) AND place them as
   guests on relevant shows (reach + authority by association). *Dealflow Media + Kobi's network*
3. **Personal-brand content engine** — LinkedIn, articles, clips, all repurposed from the
   podcast appearances. *Kobestarr Digital*
4. **AI-search optimisation** — schema, entity establishment, citations in the sources AI pulls
   from (directories, comparison pages, Reddit, Wikidata), plus measurement. The through-line.

The old kobestarr/dealflow/stripped buckets now just decide **which component leads**:
broken-site founders lead with the build; media/founder-fit lead with the podcast; everyone
gets the authority system underneath.

## The unfair advantage
No other web agency can credibly say "we'll get you on the right podcasts." Kobi co-chairs the
UK Podcast Roundtable, runs Dealflow Media, lives in the audio industry. That's the moat.

## Packages (structure — Kobi sets the numbers)
- **Free: AI-visibility audit.** The door. Auto-generated per company from our data (their
  aiScore, what's missing, the queries they don't show up for). Near-zero friction, high value.
- **Foundation (one-off):**
  - *Build* — AI-ready website for the broken/thin/404 founders. [£ build]
  - *Retrofit* — keep the site, make it findable (schema + content + entity). Easier first yes. [£ retrofit]
- **Authority Engine (monthly retainer):** podcast appearances + content engine + ongoing
  AI-search work. The LTV. [£/mo]

## Proof anchor
Dr Nigel Stephens ("invisible to the name people find and trust online — same playbook, your
category"), Twiggy, the Dealflow founder podcast, the UK Podcast Roundtable seat.

## The ladder
Free AI-visibility audit → Foundation (build or retrofit) → Authority Engine retainer.

---

## Outreach openers (Kobi house style — no dashes, warm, specific)

Channel: the list has decision-maker LinkedIn for ~97%, so lead on **LinkedIn via Prosp**, email as backup.

### LinkedIn (short)
> Hey {{firstName}}, congrats on the raise. Quick one — I checked how {{company}} shows up when
> people ask ChatGPT and Perplexity about {{category}}, and right now you're basically invisible.
> Very fixable. Helping founders become the name AI recommends is what I do. Worth a chat?

### Email (longer)
> **Subject:** {{company}} is invisible in AI search, {{firstName}}
>
> Hey {{firstName}},
>
> Congrats on the raise. I build the online presence for people who want to be the name their
> market trusts, most recently Dr Nigel Stephens and Twiggy.
>
> I looked at how {{company}} shows up when a buyer asks ChatGPT or Perplexity about
> {{category}}, and right now you basically don't. {{evidence}}. For a company that's just
> raised, that's a lot of pipeline walking past you.
>
> The fix isn't a prettier site. It's getting you cited where AI looks (the right content and
> structure) and getting you onto the podcasts and into the conversations that build authority.
> I run a founder podcast and sit on the UK Podcast Roundtable, so that part is genuinely my world.
>
> Worth a look? I can send a short audit of exactly where you're invisible and the three things
> I'd fix first.
>
> Cheers,
> Kobi, Kobestarr Digital

### `{{evidence}}` per site status (from the CSV)
- **404 / dead:** "your site is actually returning an error right now, so there is nothing for an AI to read"
- **thin:** "your site has barely enough content for Google to read, let alone an AI to quote"
- **ok but aiScore 0-1:** "you have a site, but there is no structured data or depth for an AI to pull from, so it skips you"

### Variables → CSV columns
`{{firstName}}`→ Decision Maker First Name · `{{company}}`→ Organization Name ·
`{{category}}`→ Industries (simplified) · `{{evidence}}`→ derived from `siteStatus`/`aiScore`.

### Real examples (from this month's hot list)
- **CoverX AI — Joe Chase (Founder), Pre-Seed, site 404:** "I looked at how CoverX AI shows up
  when someone asks AI about insurance tech, and you basically don't — your site is returning a
  404 right now, so there's nothing for it to read."
- **Basics — Akeil Smith (Founder), Pre-Seed, site ok / aiScore 0:** "You've got a site, but
  there's no structure or depth for ChatGPT to quote, so when someone asks AI about your space,
  it skips you."
