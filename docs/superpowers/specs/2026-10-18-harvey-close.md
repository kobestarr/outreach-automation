# Harvey 3: close (won and lost)

Date: 18 Oct 2026. Status: design, not built. Follows: post-call-and-proposal.

## Goal
Won deals get a draft invoice, a kickoff pack, a claimed patch and a proof bank entry in minutes. Lost deals record why and go to the right place: a 90-day nudge, or a permanent block.

## Trigger
GHL stage change, polled every 10 minutes by `close-run.js` (Mac LaunchAgent) from the opportunity search of each brand's "Cold Email" pipeline (and "Marketplace" for spec 6). Kobi moves the card in GHL or uses a dashboard button. Harvey never moves a deal to Won or Lost itself. Each transition is processed once (`data/harvey/closed.json`, keyed by opportunity id plus stage plus date).

## Won

### 1. Invoice draft (never sent)
`invoice-draft.js`: `draftInvoice({ client, country, currency, lines })`.
- Country from the Companies House record, the proposal, or the GHL contact address. UK (GB) goes to **FreeAgent**. Anyone else goes to **Stripe**.
- FreeAgent: create or find the contact, create an invoice with status Draft. Stripe: create or find the customer, create an invoice in draft with `collection_method=send_invoice`, not finalised.
- Lines come from the accepted proposal (fee, deposit, monthly terms). Currency follows the client (USD for US, as with the City View Green deal). VAT: FreeAgent applies UK rules; Stripe left to Kobi's check.
- Result posted to Buzz with a link to the draft. Kobi opens, checks, sends. A second Won event for the same opportunity never makes a second draft.
- Read the live FreeAgent and Stripe API docs before building. FreeAgent needs an OAuth token that expires, so refresh and alert on failure. Keys come from the vault; never printed.

### 2. Onboarding kickoff
Harvey drafts (not sends): welcome email, a kickoff call invite text with two slots from Kobi's free calendar, an access checklist (site, analytics, ad accounts, domain), and a first-30-days plan lifted from the accepted proposal's milestones. Follows the `onboarding-upsell` skill if present. Drafts appear in Today.

### 3. Claim the patch (local clients only)
`claim-area.js`: appends to `data/claimed-areas.json`:
`{ trade, area, areaType: 'town'|'postcode_district', client, brand, domain, claimedAt, opportunityId, release: null }`.
- Local means trade or service business sold on a local-area basis (flag from the campaign tag, or Kobi's tick box in the Buzz prompt). Funded startups and professional services do not claim.
- Area comes from the CRM record (town or postcode); if unclear, Buzz asks Kobi one question.
- The sourcing side reads this file: `send-batch.js` and weekly autopilot skip any lead whose trade and area match a claim (same rule as the existing window-cleaner protection), and `data/held-*` explains why.
- Conflict check first: if the patch is already claimed, Buzz warns before anything is written.
- Release: Kobi sets `release` when a client ends.

### 4. Proof bank
`proof-entry.js` drafts an entry in the proof bank's format: client, what we did, result (empty until Kobi fills a number), date, quote placeholder, and a **permission flag** defaulting to "not cleared". It is written to `docs/proof-candidates.md` here and surfaced in Buzz. It moves into the canonical Obsidian file `systems/marketplace-profile-kit.md` section 0 only after Kobi confirms the client agreed. Harvey never publishes a client name.

### 5. GHL and record
Stage stays Won. A note logs invoice link, claim, kickoff date. The value is set to the first-year fee for the funnel and to the real invoice total once sent.

## Lost
Buzz prompt (and dashboard dropdown) asks for a reason: `price | timing | went elsewhere | no need | ghosted | wrong fit | hard no`. Free text optional. Stored as a GHL note plus a tag `lost:<reason>`; feeds the Monday report ("why we lose").
- **Not now**: GHL stage Not now, `resumeOn = today + 90 days`. At day 85, `nudge-run.js` drafts a short check-in using the original call notes and any trigger Harvey can see (new job ad, new filing). Kobi sends. If they reply, spec reply handler takes over.
- **Hard no or removal**: call the shared `blockEverywhere(email, reason)` from the reply engine, the existing Kobi standard of 18 Oct: Mailead `update_blacklist`, `email-finder suppress`, and `data/do-not-contact.txt` plus `data/sent-ledger.txt`. Also stops all follow-ups and nudges. No confirmation question.
- **Wrong fit or went elsewhere**: no block, no nudge unless Kobi asks. 
- "Ghosted" after day 6 is Kobi's call: Not now or Lost.

## Failure modes
- Invoice API down: Buzz alert with the exact fields so Kobi can raise it by hand; retried hourly, once.
- Country unknown: Buzz asks; no invoice until answered.
- Stage flapping (Won then back): processed events are idempotent; a Won reversed after a draft exists adds a warning, deletes nothing.
- Claim file corrupt: atomic writes and a daily copy in `data/harvey/backup/`.

## Tests
Country routing (GB to FreeAgent, US to Stripe, unknown asks); draft only, never finalised (assert the call parameters); idempotent Won; claim conflict; claim read by `send-batch` fakes; each lost reason path; 90-day date maths including month ends; hard no calls all three block steps (fakes) and cancels follow-ups; proof entry permission defaults to not cleared.

## Stays human
Moving Won or Lost, checking and sending invoices, kickoff, proof permission, anything sent to a client.

## Open questions for Kobi
1. Should Won also create a Stripe or FreeAgent recurring plan for monthly retainers? Recommended: no, one draft invoice for the first month, add recurring by hand.
2. Local patch size: town or postcode district? Recommended: the client's service area as stated, default to town plus 5 miles.
