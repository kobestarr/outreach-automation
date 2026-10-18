# Harvey 6: marketplaces (Upwork, Twine, Bark.com)

Date: 18 Oct 2026. Status: design, not built. Uses Kobi's skill `kobestarr-tools/skills/custom/marketplace-brief-response` (brief analysis prompt, lead scoring, 6-part cover note, Loom structure, brand choice). Harvey does not rewrite that skill.

## Goal
A good brief becomes, within minutes, a Loom script and a cover note in Kobi's hands. Kobi records the Loom and submits. Speed matters: 78% of buyers hire the first responder, and Bark leads older than 30 minutes are skipped.

## How briefs arrive (checked against the repo, must be re-verified live)
- **Twine**: already live. `twine-watcher.js` on clawdbot reads public role pages every 15 minutes and WhatsApps scored briefs. Alert emails from no-reply@twinehq.com also arrive. Harvey reuses the watcher's parsed brief (role, title, budget, location, URL, posted time). No Twine API exists.
- **Bark.com**: the Zapier hook has been dead since 20 May 2026 and stays dead (Kobi does not pay for Zapier). Route: switch on Bark's own lead emails in account settings, plus the Bark Seller app push. Harvey reads those emails from Gmail (see below). Open: confirm which address Bark emails.
- **Upwork**: saved-search job alert emails to Gmail. Upwork RSS was withdrawn in 2024 (to verify) and the API is restricted, so email is the feed. Set 3 saved searches matching the service boundary.
- **Gmail access**: VPS IMAP collection already exists for replies. Add a label rule per platform sender; the intake job reads those labels. No new credentials.

## Units (own folder `harvey-marketplace/`, shares `shared/harvey` helpers)
1. `brief-intake.js`: per-platform parsers to one shape `{ platform, id, url, title, body, budget, currency, location, postedAt, clientNotes, proposalsSoFar, receivedAt }`. Dedupes on platform plus id. Unknown format: saved raw and a Buzz "parser needs a look".
2. `fit-score.js`: two stages. Hard gates first (Haiku 5.5): remote or digital only; not PR; no in-person work; not outside Kobi's services (marketing, SEO and AI visibility, paid ads, websites and analytics, podcast and content, B2B editorial, AI automation). Fail any gate: `Skipped` with the reason. Then the skill's score (budget, scope, client history, competition, fit, urgency; 20+ respond now, 15 to 19 respond if the pipeline is light, under 15 skip). Brand picked by the skill's rule (Kobestarr Digital, Stripped Media, DealFlow Media).
3. `brief-research.js`: for score 15+, fetch the client's site or profile if given and collect one specific, checkable thing: e.g. the ChatGPT visibility check, a missing page, a slow page, an unclear offer. Evidence saved with a screenshot path and exactly what to show on screen.
4. `draft-pack.js` (Sonnet 5.5):
   - **(a) Loom script**, 60 to 90 seconds. Opens with their name and project. Then answers **each question or requirement in their brief in order, point by point**, quoting their words, ending each point with the concrete first step. Includes a timestamped "show on screen" cue for the specific finding about their business. Close: one soft question.
   - **(b) Cover note**, 150 to 250 words, 6 parts from the skill. Line one is `[Loom link]` placeholder. Platform tweaks: Twine one page and outcome-led; Bark under 5 minutes; Upwork specific, with fewer than 10 proposals preferred.
   - Checklist from the skill run in code (no "I am", under 250 words, one proof point with a number, ends with a question, British English, no em dashes). Proof matched to buyer type from the proof bank; never invented.
5. `marketplace-ghl.js`: GHL tracking (below).
6. `submit-helper.js`: opens the brief URL and copies the note. It never submits.

## Alert and flow
Buzz ~outreach post: score, brand, budget, age of brief, cost to apply, Loom script, cover note, "show this" cue, brief link. Dashboard Today shows "Marketplace drafts ready". Kobi records, submits, then presses "Submitted" (or Harvey sees the confirmation email). **Nothing is ever submitted automatically**: Connects, Bark credits (3 to 20 credits, about £1.20 + VAT each) and Twine applications all cost money. Dashboard shows credits spent this week; Harvey warns at a weekly cap.

## GHL "Marketplace" stage set (Kobestarr sub-account, new pipeline)
New brief > Skipped | Drafted > Submitted > Client replied > Call booked > Proposal sent > Won | Lost. The existing "Bark Leads" mapping in `ghl-router.js` is retired once this exists. Source tag `source:upwork|twine|bark`. Calls booked from here join specs 1 to 3; Won uses spec 3, including the platform review request template from the skill.

## Failure modes
Brief older than 30 minutes (Bark): marked "stale", still drafted but flagged. Parser break: raw saved. Duplicate briefs across platforms: matched on client name plus title. Model drafts a claim not in the proof bank: checklist blocks "ready". Platform terms change: re-read the live help pages before each platform's first build.

## Tests
One fixture per platform email and Twine page; each hard gate (a PR brief, an in-person brief, a data-entry brief all skip); score thresholds; Loom script contains one answer per extracted requirement; cover note limits; no network write in `submit-helper`; dedupe.

## Stays human
Recording the Loom, editing, submitting, paying Connects or credits.

## Build here or separately? Recommendation: a separate session
- Different inputs, different clock (minutes, not days), different code folder.
- It shares only GHL, Buzz and the Won flow, all of which exist after today.
- It can run alongside the cold-email build without blocking the 21 Oct and 30 Oct targets, and may close faster (a £1,500 Twine job can land in a week).
- Risk of folding it in: it delays call-brief work needed by Wednesday.

## Open questions for Kobi
1. Weekly credit cap for Bark, Twine and Upwork? Recommended: £30 a week to start.
2. Switch on Bark lead emails and Upwork saved-search alerts now (10 minutes, you only). Recommended: yes, today.
3. Which address should alerts go to? Recommended: kobi@kobestarr.io with a Gmail label per platform.

## Revisions after adversarial review (18 Oct 2026, binding)
- **Own pipeline (M6).** Marketplace calls need their own GHL pipeline **"Marketplace"** (Kobestarr sub-account). So `moveStage(email, brand, stageName)` must gain a **required `pipeline` parameter**: `moveStage(email, brand, pipeline, stageName)`. This is a required change to the GHL tracker being built today; booking, proposal and close specs pass `'Cold Email'` or `'Marketplace'`.
- **Value (M7).** GHL value is monthly; one-off fee in a custom field.
- **Where it runs (M9).** The Bark window is 30 minutes, so intake and scoring run on the **VPS clawdbot** next to `twine-watcher.js` and the IMAP collection. Mac only drafts nothing; drafting also runs on the VPS so the Buzz post lands in minutes.
- **Bark staleness (minor).** Skip Bark leads over 30 minutes old (the skill rule). They are not drafted; the earlier "stale but drafted" line is removed.
- **Never invent a client name (minor).** Upwork hides client names. Drafts address "Hi there" or use only the name shown; the checklist fails any name not in the brief.
- **Loom length (minor).** 45 to 60 seconds, per the skill (the 60 to 90 second line is removed). Answer each requirement point by point inside that time; if more than three requirements, the script covers the top three and the cover note covers the rest.
- **Reuse.** Use the Loom script generator and lead qualifier `qualifyLead()` in `kobestarr-engine/lib/claude.js` before writing new prompts; wrap, do not copy.
- **Labels and Won.** Won from this pipeline uses the spec 3 checklist.
- **Build.** Separate session, in parallel with specs 1 and 2, starting once `moveStage` has the `pipeline` parameter.
