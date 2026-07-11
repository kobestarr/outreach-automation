# Signal Engine — launch assets (self-contained reference)

Reusable components for product/launch videos, App Store / marketing content, and case studies.
Built overnight 2026-07-11. Pull from here rather than re-deriving.

## One-liner (the hook)
"The moment a company posts a job, they've told the world they have a gap and a budget. Signal Engine
turns LinkedIn's job board into a weekly list of exactly those companies, matched to the right person to
talk to, ready to reach."

## The problem it solves (for a launch video cold-open)
Cold outreach is guesswork: you email people who have no reason to care, right now. A hiring signal flips
it: intent + budget + timing, all in one public post. But raw job boards are noise (recruiters, gig
platforms, giants, wrong contacts). Signal Engine is the filter and the finder.

## The three-line value prop
1. FIND the intent: companies hiring for what you sell, this week, in your market.
2. FIND the person: the actual decision-maker, never a default-to-CEO guess (it reads the seniority of
   the posted role to know whether the founder or a department head owns the budget).
3. HAND YOU the shortlist: a triaged digest, one company per row, with the resolved director and a
   verified email, sorted into how to approach them. You send nothing until you say go.

## The clever bit (the "wow" for a demo)
It reads the posted ROLE to place the buyer. Hiring a Head of Marketing? That seat is empty, so the
FOUNDER feels the pain right now (hottest moment). Hiring a junior exec? A department head already exists,
so pitch THEM as support, not the CEO. Small company? Always the founder. No other tool reasons about who
to contact from the shape of the job post.

## Proof of craft (for credibility / case study)
- Built in one night, fully test-driven: 130+ automated tests across 6 modules.
- Adversarially reviewed at every step: an architecture skeptic caught 4 contract-breaking design flaws
  before any code; a code adversary caught 2 cross-module bugs that would have dropped 100% of leads; a
  marketing-savant reviewed every line of the outreach copy to a "would this wow a founder" bar.
- Real run proof: [FILL from the morning digest — e.g. "sourced N signals across 3 brands, resolved M
  real decision-makers via Companies House, produced a triage list of X qualified leads"].

## Screens / artifacts to capture (for video/App Store)
- The digest.md output (the triage table) — the money shot.
- A single digest ROW zoomed: company + one-liner + role + resolved director + email + lane + verdict.
- The lane split (emailLead / prospConnect / manualFind / websitePitch / dropped) as a funnel graphic.
- Terminal run: `node run-signal-engine.js --brands ... --skip-linkedin` streaming stage-by-stage.
- Before/after: "raw LinkedIn search: 25 results, 60% junk" vs "Signal Engine: N clean, founder-direct leads."

## Positioning against alternatives (for a comparison slide)
- vs buying a lead list: those are static and cold; this is fresh weekly intent.
- vs a VA scrolling LinkedIn jobs: this filters recruiters/gig/giants automatically and finds the RIGHT
  contact, not the recruiter who posted.
- vs generic "intent data" tools: those infer intent from web behaviour; a job post is intent stated out loud.

## The brands it feeds (for a multi-brand story)
One engine, three revenue lines: Kobestarr (AI-search + web), Stripped (podcast production), Dealflow
(founder content + podcast). Same signal, different filter and pitch. And the same engine is the Hirewire
product for Recon/Axon Moore (CFO/FD hiring signals) — dogfooding a sellable product.

## Taglines to test
- "Their job post is your best lead."
- "Reach the company the day they realise they need you."
- "Intent, stated out loud."
