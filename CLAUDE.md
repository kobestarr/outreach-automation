# CLAUDE.md — Outreach Automation (project rules)

Multi-campaign local-business outreach: discover → enrich → verify → multi-channel export. Read `PRD.md` + `ROADMAP.md` + `docs/NEXT-STEPS.md` first. Follow the global Superpowers workflow.

## Operating rules (strict)
- **DB is sacred.** SQLite at `ksd/local-outreach/orchestrator/data/businesses.db`. Auto-backs up on init; force a backup before any bulk mutation. It is gitignored — never commit it; commit log files (`data/*.txt`, `data/*.log`) instead.
- **Credits cost money. Dry-run first.** Every sourcing/verify script supports `--dry-run` — use it before live runs. Outscraper ≈ $0.002/result; Reoon 2,100/day; Consulti `/leads/search` = 1 lead credit per result (0-result queries free).
- **Two sourcing engines, distinct uses:** Outscraper (Google Maps, postcode-precise) for trades/medical/local-precision; Consulti `/leads/search` (B2B DB, email+LinkedIn included) for professional services. NEVER use Consulti `find-by-name` for UK medics (proven 0/33). See memory `reference-consulti-coverage-gaps`.
- **Consulti queries MUST pin `countries:["United Kingdom"]`** (codes UK/GB return 0). No UK postcode/sub-city targeting exists; `total` caps at 10,001.
- **No pubs** (excluded category). **Trades campaign excludes cleaning/window/gutter/carpet** (protects David Wood client).
- **Verify before export/send.** Website-scraped emails = auto-valid; everything else gets Reoon/Consulti verify before a sender sees it.
- **Subject lines** never finalised without a cold-reader audit (memory `feedback-subject-lines-cold-reader`).
- **Campaign tags** are the unit of work; businesses can carry several. Generic press lists use `press-<beat>`, not client-prefixed.

## Key scripts
- `source-consulti-leads.js` — Consulti B2B sourcing (`--vertical/--cities/--terms/--tier/--start-page/--max-credits/--dry-run`)
- `explore-area-businesses.js` — Outscraper area scraper (verticals + tiers)
- `enrich-campaign.js` / `export-campaign.js` / `verify-existing-emails-consulti.js` — pipeline
- `batch-bramhall-all-categories.js`, `explore-football-clubs.js` — original KSD/UFH scrapers

## Node note
`node` lives at `/usr/local/bin` (moved from `/opt/homebrew/bin` by Oct 2026; `gcloud` may still be there). Prefix `PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"` if a command isn't found. LaunchAgents cannot write to `~/Downloads` (macOS blocks it): scheduled jobs write to `exports/`. Notifications go to Buzz ~outreach via `node mailead-alerts-buzz.js --post "msg"` (WhatsApp bridge down since 13 Oct 2026).
