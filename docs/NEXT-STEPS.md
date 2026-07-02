# NEXT STEPS — pick up here

**Updated:** 2026-07-02 · Branch: `may-launch-consulti-burn`

## NEW: send-batch pipeline is LIVE (2026-07-02)
- **One command:** `node send-batch.js <csv> --campaign <key> [--dry-run] [--limit N] [--skip-verify]`
  Normalise → dedup (file + `data/sent-ledger.txt` + target sheet) → Reoon verify → carrier insights → append to the campaign's Google Sheet (`ToSend` tab). Spec: `docs/superpowers/specs/2026-07-02-send-batch-pipeline-design.md`.
- **ksd-pro-services**: 816 pushed to [the campaign sheet](https://docs.google.com/spreadsheets/d/1xcyH8DetTxqJWBfWRicAl0FEYyVJ8FvZ6F46W-k_D08/edit) (in the shared "Lead Pipelines" Drive folder). Insight packed into the `Last Name` Mailead column (template: `docs/insight-templates.md`); real surnames preserved in the reference block.
- **Ledger:** `data/sent-ledger.txt` (1,126) = resend protection. Seed more with `node seed-ledger.js <loaded-csv>`.
- **New campaign =** create blank sheet IN the Lead Pipelines folder → `node send-batch.js --register <key> <url>` → add carriers to `config/campaign-sheets.json`. (Google blocks SA auto-create: 403 quota.)
- **REMAINING LAST MILE:** build the TaskMagic flow (sheet → new dated Mailead campaign, map ONLY Title Case columns, 2-lead test first) + adapt sequence copy to `{{last_name}}` per `docs/insight-templates.md`. See `docs/mailead-taskmagic-SOP.md` Part C.

## Where we left off (2026-05-28)
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
