# NEXT STEPS — pick up here

**Updated:** 2026-05-28 · Branch: `may-launch-consulti-burn`

## Where we left off
- **2,862 KSD B2B contacts** sourced into `ksd-local-2026` via Consulti `/leads/search` (Manchester, Stockport, affluent NW, London). All have email + LinkedIn. **NOT yet verified, exported, or emailed.**
- **Consulti credits: ~7,622 lead + ~23,653 verify. EXPIRE 31 MAY 2026.**
- Tools built: `source-consulti-leads.js`, `explore-area-businesses.js`.
- Beta-feedback email to Consulti is in Gmail Drafts (jay@consulti.ai).

## The 3 most potent next steps (in order)

### 1. Verify + launch the 2,862 KSD B2B contacts (value realisation)
```bash
node verify-existing-emails-consulti.js --campaign=ksd-local-2026     # or Reoon
node export-campaign.js --campaign=ksd-local-2026 --clean --has-email --format=lemlist   # or mailead
```
Then: write copy (SUBJECT LINES NEED A COLD-READER AUDIT — see memory `feedback-subject-lines-cold-reader`), test-send to self, launch. Nothing has been emailed yet — this is where leads become revenue.

### 2. Burn remaining ~7,622 Consulti lead credits before 31 May (3 days, time-critical)
```bash
node source-consulti-leads.js --vertical=broad --cities="Birmingham,Leeds,Bristol,Edinburgh,Glasgow,Sheffield,Nottingham" --max-credits=4000
node source-consulti-leads.js --vertical=broad --cities="Guildford,Bath,Cheltenham,Harrogate,Royal Tunbridge Wells,Sevenoaks,Weybridge,Esher,St Albans" --max-credits=2000
```
1 credit = 1 email+LinkedIn B2B contact; 0-result queries free. Always pins `countries:["United Kingdom"]`. Use `--start-page` to avoid re-paying for already-pulled cities. Mind the 10,001 `total` cap (can't rank big cities by it).

### 3. Outscraper for postcode-precise / thin-on-Consulti slices
`explore-area-businesses.js` is built (verticals broad/trades/medical, tiers, cleaning exclusion). Use it for affluent London boroughs and the trades/medical verticals Consulti can't serve.

## Gotchas to remember (full detail in memory `reference-consulti-coverage-gaps`)
- Consulti `find-by-name` is a DEAD LOSS on UK medics (0/33). Use `/leads/search` instead.
- Consulti has NO UK postcode/borough targeting; town/city name only. US boroughs work, UK don't.
- Must pin `countries:["United Kingdom"]` (codes UK/GB fail). Exact spelling matters ("Royal Tunbridge Wells" not "Tunbridge Wells").
