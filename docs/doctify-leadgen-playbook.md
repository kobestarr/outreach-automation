# Doctify Lead-Gen Playbook & Feasibility

**Created:** 2026-05-30 · Status: **feasibility validated (spike), not yet built**
Owner: Kobi (KSD). Purpose: source private UK medical specialists for website
design/redesign outreach (the "doctors website pitch", cf. Nigel Stephens case study).

---

## 1. Feasibility — proven on live data

Doctify (`www.doctify.com`) is a **Next.js site that server-renders every
specialist's full record into the page HTML** (`<script id="__NEXT_DATA__">`).
No auth, no API key, no JS execution, no Algolia call needed — the data is in
the document.

- **Scale:** `https://www.doctify.com/sitemap.uk.specialists.xml` enumerates
  **~42,400 UK specialist profile URLs**. Sitemap index: `/sitemap.xml`.
- **Profile URL pattern:** `/uk/specialist/<slug>` (e.g. `mr-manoj-sood`).
- **Listing URL pattern:** `/uk/find/<specialty>/<location>/specialists`
  (the `specialists` array in `__NEXT_DATA__` carries 10 full records/page,
  emails included — so you can harvest from listings *or* profiles).

### Fields available per specialist (read straight from the payload)
`fullName`, `title`, `suffix` (e.g. "FRCS(Tr & Orth)"), `slug`, `gender`,
`emails[]`, `phones[]`, `bookingPhones`, `consultationFees` (new/followUp/currency),
`registrationBodies` (incl. **GMC number**), `keywords` (specialty),
`yearsOfExperience`, `languages`, `insurers`, `reviewsTotal`, `averageRating`,
`peerRecommendationsCount`, `aiSummaryReview`, and `practices[]` — each with
clinic `name`, `address` (city, county, Google Place ID), `externalBookingLink`,
and `customFields` (`{hca, nuffield}` flags). No dedicated "website" field.

### Coverage (sample of 90 specialists across 9 specialty/city pages)
- **88% had an email in the payload** (79/90).
- Primary-email domain split: **65% custom domain**, 14% free (gmail/outlook),
  13% hospital-group, ~9% NHS.
- **Of the custom domains, 86% resolved to a live website** (floor — 7 of 49
  were connection errors/bot-blocks, not confirmed dead).

---

## 2. The 4-tier qualification model

Doctify has **no website field**, so web presence is *inferred then verified*
from two signals: the **email domain** and the **practice `externalBookingLink`
domain**. That yields four tiers, each with a different pitch:

| Tier | Signal | Pitch |
|---|---|---|
| **T1 — Owns personal site** | email/booking on a personal-name domain (`drsmith.co.uk`), surname appears on the site | **Redesign / modernise / reactivate** |
| **T2 — Owns/runs a clinic** | generic clinic domain (`londonheartcentre.com`), they're principal/founder | **Redesign**, pitch the principal |
| **T3 — Tenant at group/hospital** | booking link → Circle/HCA/Spire/Nuffield or a private hospital (Cromwell, KEVII, New Victoria, Cleveland Clinic) | **Build** — "you have no independent presence, own your patient relationships" |
| **T4 — No web presence** | free email + no own/clinic booking link found | **Build** — strongest cold pitch |

**Caveats (be honest):**
- The booking-link classifier needs a **fuller private-hospital dictionary** —
  first pass only caught the big chains; Cromwell / King Edward VII / New
  Victoria / Cleveland Clinic London leaked into "own site" and are actually
  landlords, not the doctor's site. So the true T3 bucket is **larger** than the
  first pass showed.
- **"gmail = no website" is wrong as a hard rule.** Free email = *the email
  can't tell us*; you must check the booking link / a name+clinic search before
  concluding no site. The strong, checkable signal is the *opposite*: custom
  domain → that domain IS the site.
- **Team-size (solo vs practice) needs a second fetch** of `/team` or
  `/our-specialists` — the homepage scrape under-counts on JS-rendered sites.

---

## 3. Worked example — Mr Manoj Sood (validates the whole pipeline)

Profile: `/uk/specialist/mr-manoj-sood`. Consultant Orthopaedic Surgeon (hip/knee).

- Doctify gives **`office@manojsood.co.uk`** — an email his own practice site
  (`hipandkneesurgery.co.uk`) never exposes (phone/form only).
- **Identity cross-confirmed three ways:** Doctify phone `+442071274202` == the
  site's London number; Circle booking links carry `consultant=C3668953` == his
  **GMC number** on Doctify. No guessing.
- **Killer pitch hook:** his own site lists his hospital as "BMI Hendon"; Doctify
  shows "Hendon Hospital (part of Circle Health Group)". BMI→Circle rebranded
  ~2020–22, so **his site carries a hospital brand ~5 years dead**. Plus a
  Gantry-5 theme and content that peaked 2014–2019. Concrete, verifiable
  "your site is out of date" opener — not a vague one.
- Tier: **T1** (owns his presence, solo principal) → redesign/reactivation.

---

## 4. Email verification strategy

**Doctify emails are PUBLISHED contact addresses** — the practice deliberately
lists them to receive enquiries. That puts them close to the project's existing
"website-scraped emails = auto-valid" rule: low intrinsic bounce risk.

Recommendation:
- **Custom-domain role/personal addresses** (`office@manojsood.co.uk`,
  `info@clinic.co.uk`): treat as near-auto-valid. A light **MX + domain-liveness**
  check is enough (we already proved 86% of domains resolve). These are also the
  best **PECR** footing — corporate-style addresses, not personal individuals.
- **Free-email addresses** (gmail/outlook): **Reoon-verify before send** — both
  for deliverability and because they're the ambiguous slice.
- **nhs.net: exclude entirely** (closed filtered system, bounces — see the
  cardiologist hard-bounce list; and wrong context for a *private*-practice pitch).
- **Do NOT spend Consulti verify credits on Doctify.** Reasons: (a) the scraper
  isn't built, so we can't realistically scrape+verify 42k before the 31-May
  expiry; (b) Consulti is a B2B-DB verifier with a known **medical blind spot** —
  wrong tool for arbitrary published medical emails; (c) those expiring verify
  credits are better spent on the existing 2,862 + fresh Consulti B2B leads.
  **Use Reoon** (2,100/day, no expiry, SMTP-level) for Doctify, later.

**Net answer to "do we even need to verify Doctify emails?":** not heavily —
custom-domain ones are high-quality published addresses; do a light MX check and
Reoon only the free-email slice. Don't skip entirely (sender reputation on
Mailead/Lemlist punishes bounces), but don't burn premium verification on them.

---

## 5. Monday go-to-market approach

**Segment first (4-tier), then pitch per tier.** Personalisation is the whole
edge: each email references the specialist's *actual* site, specialty and
hospital (e.g. the BMI→Circle staleness), which Doctify + one site fetch hands
you per person.

- **Case study:** lead with **Dr Nigel Stephens** (KSD-designed site). Match the
  proof to the segment where possible (same specialty/region lands harder).
- **Channel:** medical audiences are cold-email-wary. Prefer a **lower-volume,
  high-personalisation** sequence via Lemlist (kobi@kobestarr.io, multichannel)
  over a Mailead blast; consider **LinkedIn-first via Prosp** as a warmer touch
  (specialists are on LinkedIn; needs separate LI sourcing).
- **Address selection:** prefer **corporate role addresses** (`office@`,
  `info@practice.co.uk`) over personal gmail — better deliverability, better
  PECR footing. Note these reach a **PA/practice-manager gatekeeper** (e.g.
  Sood's "Debbie"), not the surgeon — write for that reader.
- **Subject lines:** run the **cold-reader audit** before finalising (project rule).
- **Pilot, don't blast:** Monday = a small pilot batch (~50–100 T1 redesign leads,
  London + NW, one or two specialties) to test message + deliverability before
  scaling. Warm up; throttle; protect domain reputation.

**Compliance posture:** GDPR legitimate-interest is *arguable but not slam-dunk*
— these emails were published for patient enquiries, not B2B marketing (purpose
mismatch). Keep volume low, relevance high, opt-out one-click; honour the
existing GDPR opt-out registry + hard-bounce exclusions; exclude nhs.net.
Confirm comfort with the Doctify-ToS / purpose question before scaling.

---

## 6. Build checklist (when greenlit — currently a spike, not built)
1. Scraper: walk `sitemap.uk.specialists.xml` → fetch profile → parse
   `__NEXT_DATA__` → normalise into `businesses.db` schema (campaign tag e.g.
   `medical-doctify-2026`). Throttle + cache; respect robots (`/uk/api/*`,
   `/webapi/*` disallowed — but profile *pages* are allowed).
2. 4-tier classifier: booking-link domain (with full hospital dictionary) +
   email domain + optional `/team` fetch for solo-vs-practice.
3. Filters: drop nhs.net + opt-out registry; prefer corporate role emails.
4. Light verify (MX; Reoon on free-email slice).
5. Sequence + Nigel Stephens asset; cold-reader subject audit.
6. Pilot send.

**Open decision for Kobi:** the only blocker is the compliance/ToS call — the
engineering is trivial and validated end-to-end. Decide the posture before build.
