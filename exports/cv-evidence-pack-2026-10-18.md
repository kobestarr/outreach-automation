# CV evidence pack for Kobi Omenaka, 18 Oct 2026

Purpose: everything the sources say Kobi did at Bluprintx (BPX) and in the past year, so he only answers the gaps (section 5) and tailored CVs can be generated per job spec. Dates and numbers appear only where a source states them. "Unverified" means a source implies it but does not state it. No salary figures are included on purpose (CV-safe).

Path shorthand used below:
- OBS = `/Users/kobestarr/Library/Mobile Documents/iCloud~md~obsidian/Documents/Obsidian Master Vault iCloud Sync/`
- KT = `/Users/kobestarr/Development/One Hour Vibe Coder/kobestarr-tools/`
- MEM-OA = `/Users/kobestarr/.claude/projects/-Users-kobestarr-Development-One-Hour-Vibe-Coder-outreach-automation/memory/`
- MEM-G = `/Users/kobestarr/.claude/projects/-Users-kobestarr/memory/`
- MEM-BPX = `/Users/kobestarr/.claude/projects/-Users-kobestarr-Development-One-Hour-Vibe-Coder-kobestarr-tools-clients-bpx/memory/`

---

## 1. Current CV summary (10 lines)

Source: OBS `systems/kobi-cv-canonical.md` (text mirror of the PDF, synced 2026-07-24). PDF `/Users/kobestarr/Easy Access Files to Share/Kobi Omenaka CV.pdf` file date is 24 Nov 2024, so it predates BPX and everything after.
1. Headline: "Data-driven Digital Marketing Leader", Manchester, remote-first, 10+ years B2B/B2C, Chartered Chemical Engineer background.
2. Kobestarr Digital, Founder / Consultant, May 2018 to present (not a line on the PDF).
3. Natcap Research, Fractional Digital Marketing Consultant, May 2024 to present: leads 1 to 20 per week, HubSpot CRM and automation, webinar series, LinkedIn and Google Ads.
4. Gold Standard, Digital Marketing Contractor, Jan 2024 to "Present 2024" (typo): Google Ads avg CPC $1.16, +30% traffic, +25% social engagement.
5. Thallo, Head of Growth, Feb 2023 to Jan 2024: 3x traffic, 2x domain authority, 10x client acquisition.
6. Amazon (Workforce Staffing), Senior Growth Marketer, Oct 2022 to Feb 2023: Germany warehouse recruitment growth engine, agency management.
7. Entain, Senior PPC Lead, Feb 2022 to Oct 2022: £100,000/week PPC (£5.2M/yr), Canada launch.
8. Citi / Proxymity, Head of Growth, May 2018 to Feb 2022: Series A and B, 100% organic traffic growth, headcount 5 to 120+.
9. Engineering era (usually omitted): Costain, KANFA Aragon, ENI Stavanger, CB&I, 2004 to 2015.
10. MEng Chemical and Process Eng (Sheffield), MA Social Media (Salford), PRINCE2, Google Analytics and Ads certified; English, Norwegian, Brazilian Portuguese. Skills list names HubSpot and SharpSpring only; no AI, Claude Code, Make, n8n, Zapier, GoHighLevel, Marketo, Salesforce, Smartlead or HeyReach appear.

---

## 2. Bluprintx (BPX)

**Employer and status.** Bluprintx is a B2B marketing consultancy, Salesforce and Adobe partner. SLT named in sources: Phil Petrella (CRO), AT / Adrian Trzaskus, Lee Hackett (Group CEO). Kobi is PAYE-employed via Bluprint Global Ltd; employment ends about 12 Nov 2026 (Kobi, 2026-10-13). Source: MEM-OA `project-bluprintx-income-replacement.md`; MEM-BPX `MEMORY.md`; OBS `projects/BPX Outreach/Case Study - Multi-Channel Event Outreach Sprint May 2026.md`.

**Start date: NOT STATED in any source.** Earliest evidence of work: `clients/bpx/` created in the repo 2026-02-26 ("brand strategy + voice profiles"), ICP pain-points research 2026-03-03, Marketo attribution brief 2026-03-05, ad strategy and CRO audit 2026-03-09 (git: `git -C KT log --reverse -- clients/bpx`). That folder has 117 commits touching it (same git log). So he started on or before late Feb 2026. Ask Kobi (Gap 1).

**Title: NOT STATED.** Closest evidence: in the 2 July 2026 Marketing Engine ownership proposal he is "confirmed" owner of Channel 4 "Outbound / Virtual BDR" and lead of the "GTM-Engineering Operating Model" foundation (prompt engineering, workflow design, ABM orchestration, playbooks). Source: OBS `projects/BPX Outreach/marketing-engine-ownership-proposal.md`. Colleagues named as owners elsewhere: Cedric Chambers (organic), Neil Shakeshaft (measurement), so Kobi worked in a team of at least those names. Team size not stated.

### What he did and built (each with source)

| Work | What it is | Numbers stated | Source |
|---|---|---|---|
| Inbound lead intelligence pipeline | LinkedIn Lead Gen Form -> poll every 15 min (VPS cron) -> Apollo enrichment -> Claude Haiku scores against a 100-point ICP model -> Teams Adaptive Card with @mention routed by region (NA, EMEA, APAC) -> email via Microsoft Graph. Dedup, Azure AD app registration. Built May 2026 across 4 sessions. | Live test: 13 leads processed, 5 Hot/Warm cards. Routing to 6 contacts. | OBS `projects/BPX Outreach/case-study-bpx-lead-pipeline.md`; KT `engines/campaign-renderer/scripts/lead-sync.js`; MEM-BPX `CLAUDE.md` (LinkedIn Lead Sync API app approved Standard Tier 2026-03-30, per OBS `projects/bpx-marketing.md`) |
| Multi-channel event outreach sprint (May-June 2026) | Smartlead email plus HeyReach LinkedIn campaigns for Salesforce AWT Singapore (14 May), Connect and Grow Melbourne (14 May), CNX Chicago (2-4 June); six sender personas; ZoomInfo plus Apollo enrichment; Lee Hackett sends steps 1-2, regional RVP takes steps 3-4. Delivered in 48 hours from kickoff. | 3 events, 5 campaigns (3 HeyReach, 2 Smartlead), 6 senders, 820+ leads; Chicago: 4 replies and 1 Interested within 48 hours; 147 asset-management leaders across 49 firms enriched to 74% email and 76% LinkedIn coverage | OBS `projects/BPX Outreach/Case Study - Multi-Channel Event Outreach Sprint May 2026.md` |
| ZoomInfo vs Apollo enrichment comparison, Sydney Workfront event | Enrichment POC for Adobe Workfront event; 5-email invitation sequence from Lee Hackett (Smartlead) | 184 contacts enriched; Apollo second run via VPS 152/184 emails (83%); 14 emails and 13 mobiles from ZoomInfo POC on 4 companies | OBS `projects/bpx-marketing.md`; KT `clients/bpx/deliverables/workfront-au-sequence-lee-hackett.md` |
| AI Readiness Scorecard (live product) | 20-question assessment, 6 weighted dimensions, personalised 10-page branded PDF report (headless Chromium on Vercel), Marketo (14 custom fields) and Salesforce sync, consent handling, two-tier gate, adversarial AI review. Live at ai-readiness.bluprintx.com. | 300 tests; AI Readiness Survey: 187 leaders surveyed, Marketo form 2271 | OBS `projects/BPX AI Readiness Case Study.md`, `BPX AI Readiness Scorecard.md`, `BPX AI Readiness Session 2026-05-03/06-11/06-12/06-25.md`; KT `clients/bpx/websites/ai-readiness-survey/`, `clients/bpx/deliverables/ai-readiness-report/` |
| Paid media (LinkedIn Ads, Unbounce, Meta) | Round2 DTR LinkedIn campaign, 4 winning ads, Unbounce LP `agentforce-r2-ultimate-guide-march`, CRO audit with 12 hypotheses, Meta parked (card and Page permission issues) | £100/day, 2.81% CTR; LP 0 form fills (flagged as bottleneck) | MEM-BPX `MEMORY.md`; KT `clients/bpx/strategy/unbounce-cro-audit-12-hypotheses.md` |
| Marketo | Marketo REST API work (form redirect lookup, program `Global-WS-2026-03-23-1194-AI Readiness Report`), campaign attribution brief, admin action list, LinkedIn-to-Marketo capture and UTM governance | Munchkin 116-WRG-871 | MEM-BPX `reference_bpx_marketo.md`; OBS `projects/BPX Outreach/marketo-admin-action-list.md`, `UTM Link Library.md`, `CNX Chicago - Marketo Form Build 2026-05-13.md` |
| Website migration WordPress -> Webflow | Project-managed 130 pages, 301 redirect mapping (244 redirects categorised), SEO migration, analytics/tracking port, QA; launch targeted 5 May 2026. Gap analysis, migration checker scripts. | Budget £15,890 total; vendors Satva Softech, Upwork designer, content freelancer; 8 critical launch blockers found in pre-launch QA | OBS `projects/bpx-marketing.md`, `BPX-Migration-Process.md`, `BPX-Migration-Gap-Analysis.md`, `BPX Webflow Migration/`; KT `clients/bpx/migration-v2`, `run-migration-all.js`, `migration-checker.js` |
| Social content engine | Oktopost scheduling for company and leader brands; Content Review Engine (Friday workflow reads Oktopost, Asana, TrendMine); `bluprintx-social-content` skill; three SLT voice profiles; Figma content index; CMO Clarity video shorts (10 clips via Descript) | 24 posts/week operating cadence; top performers: people posts 445 engagements, event recaps 546, PDF carousels 179 | MEM-BPX `MEMORY.md`; OBS `projects/bpx-marketing.md`; KT `engines/content-review/`; skill `bluprintx-social-content` |
| Monthly Marketing Wire | Monthly Asana-driven two-page HTML+PDF marketing report built as a skill with runbook | Wire for July 2026 produced | KT `clients/bpx/marketing-wire/` (RUNBOOK.md, Marketing-Wire_2026-07.pdf); skill `marketing-wire` |
| AI/SEO/AEO | Searchable (AI visibility) prompt set rebuilt for GB, US, AU; Reddit intel pipeline; SEO heist handover; Adobe "Smart Content Supply Chain" SEO plan; content market-fit strategy | Prompt-set date 2026-08-14 | KT `clients/bpx/searchable-prompt-set-2026-08-14.md`, `seo-heist/`, `HANDOVER-seo-heist-2026-09-16.md`; OBS `projects/BPX Adobe Always-On/`; git subjects `feat(bpx): rebuild the Searchable prompt set for GB, US and AU`, `feat(bpx-reddit-intel): rebuild Mode 9 as a testable pipeline` |
| Connected Firm campaign and Signal Engine | 30-day campaign scaffold, day-1 pack, an hourly Signal Engine posting briefs and suggested replies to Teams, Cognism/Apollo reveal caps. It found a warm referral reply a human had missed (Addleshaw Goddard). | 671 runs and 0 cards, then fixed: 14 real cards 2026-08-10; spend 3 Cognism credits; 40 tests | OBS `projects/BPX Connected Firm/progress-log.md`, `plan-80-20-response-system.md`; KT `clients/bpx/connected-firm/` |
| Claude Partner Network / Claude-Powered Revenue Engine | Reviewed Lee Hackett's "Founding 20" offer decks, wrote honest feedback (60 vs 90 days, guarantee mechanics, Anthropic claims), ran buyer-side Reddit intel, leave-behind one-pager skill and templates | 2026-07-24 | OBS `projects/BPX Claude Partner Network/` (`feedback-to-lee-2026-07-24.md`, `reddit-intel-2026-07-24.md`); git `feat(bpx): Claude Revenue Engine leave-behind template` |
| Internal tools (Teams plus Asana) | Contractor calculator and supplier intake automation: Asana webhook, Teams card, MS Graph email, reviewer notifications | Not stated | git subjects `feat(bpx-contractor-calc)...`, `fix(bpx-supplier-intake)...`; KT `clients/bpx/contractor-calc` |
| Case studies and designer briefs | EFEX case study, designer briefs, Figma review of Capabilities and AI Strategy pages (11 comments, 6 April) | EFEX case study text exists | KT `clients/bpx/deliverables/efex-case-study.md`; OBS `projects/bpx-marketing.md` |
| Adobe / Salesforce campaigns, ABM, board pack | Adobe wealth campaign, AWM leadership enrichment, KPI tree, channel-ownership proposal, board pack content, meeting with Tammy and Cedric on content plan | Marketing engine: events source 52% of pipeline, paid 5% of pipeline (from the ownership proposal's own analysis) | OBS `projects/BPX Outreach/marketing-engine-kpi-tree.md`, `board-pack-june-2026-content-additions.md`, `projects/BPX Adobe Always-On/`, `projects/BPX Master Content Calendar/` |

**Clients / teams served at BPX (named in sources):** Lee Hackett (Group CEO), Phil Petrella (CRO), Adrian Trzaskus, Neil Shakeshaft (marketing lead), Cedric Chambers (organic), Cameron Young, John Kirwan (EMEA sales), Adam Troughear and Tammy Begley (APAC), Wayne Stober (US events), Paul Dobinson. Customer/partner names appearing: Adobe, Salesforce, Domino's (Workfront event), EFEX.

**BPX tools evidenced:** Marketo, Salesforce, Asana, Oktopost, Smartlead, HeyReach, Apollo, ZoomInfo, Cognism, LinkedIn Ads and Lead Sync API, Unbounce, Meta Ads, Figma, Descript, Searchable, Webflow, WordPress, Microsoft Teams / Graph / Azure AD, Vercel, Claude (Haiku scoring, Claude Code), Reddit.

**Manager quote:** none found. Closest are feedback notes ("senior stakeholder feedback" drove the AI Readiness reframe) with no attributed praise. Ask Kobi (Gap 9).

---

## 3. Other work in the past 12 months (since ~Oct 2025)

| Work | Evidence | Source |
|---|---|---|
| **Natcap Research** (fractional marketing, ongoing) | 1 to 20 leads/week; LinkedIn headline claims "1,900% more leads"; CV says 2,000%. Reconcile the number (Gap 7). | OBS `systems/kobi-cv-canonical.md`; MEM-G `reference-kobi-linkedin-profile.md` |
| **Gold Standard** (contract, end date unclear) | CPC $1.16, +30% traffic, +25% social engagement, 0 to 10k+ subscribers (profile kit) | OBS `systems/kobi-cv-canonical.md`, `systems/marketplace-profile-kit.md` |
| **City View Green / Stable Capital Link (CVGR)**, first closed deal 8 Jul 2026 | Cold email (campaign 8886) -> audit -> call -> about $2k audit plus $2k/mo x 3 months (USD). Compliance clause mandatory (public micro-cap). In GHL; second opportunity Thermabright. | MEM-OA `MEMORY.md` section "Deals / relationships"; `reference-proof-bank.md` |
| **Window Gutter Clean (Dave Wood)** | Free site in exchange for cleans and case study: custom Gutenberg theme, 34 pages (hub, area pages), live at windowgutterclean.co.uk; used as AI-search proof ("phone won't stop ringing") | OBS `projects/dave-wood-case-study.md`; KT `clients/window-gutter-clean/`; MEM-OA `reference-proof-bank.md`. (Note: that vault note contains credentials; never copy it to a CV.) |
| **Outreach automation system** | Discover, enrich, verify, multi-channel export; Mailead direct API; reply-watcher with WhatsApp alerts; send-batch pipeline; Reoon verification; per-campaign Google Sheets; live campaigns incl. 807 accountants/solicitors at about 1.5% bounce; 6,675 B2B contacts sourced and verified; 260 commits since 2025-09-01 | MEM-OA `MEMORY.md`; git `git -C outreach-automation log --author=kobestarr --since=2025-09-01` (260, first 2026-02-02) |
| **Signal Engine (hiring signals)** | 130+ tests; first run 141 signals to 11 clean sendable leads; 4 Mailead campaigns staged | MEM-OA `project-signal-engine.md` (via MEMORY.md) |
| **Rallie** (padel events networking app, iOS+web) | Next.js, Expo, Supabase, Vercel, LinkedIn OAuth, Stripe; pilot with Manchester Padel Professionals 19-20 May 2026, live on their site; iOS builds 36 to 39 through App Store review (17 June, build 39 Waiting for Review); 41 commits since 2026-04-28 | OBS `projects/rallie/Rallie.md`, `case-study-appstore-gauntlet.md`, `case-study-mpp-pilot.md`; git Rallie |
| **Stripped Media / DealFlow Media** (podcast agencies, co-founder) | Headline claim "one tiny podcast drove £500k+"; 1,000+ episodes across 15+ shows; Simple Politics won 2 awards beating BBC/Sky/C4; clients incl. P&G, BBC, Spotify, Picturehouse, The Guardian, Twiggy (claims on his own profile, not independently sourced here). DealFlow platform rebuild "Sell-Ready Sprint" July 2026: 24 articles' prompt generator enforcing AI-citation rules (234 tests), rebrand tested with 13 expert personas to "Podcasts, with receipts"; n8n decommission project (PROGRESS file 2026-08-08), Supabase/Airtable architecture, Fit Scoring Model spec | OBS `projects/dealflow-podcast-authority/Case Study - Sell-Ready Sprint 2026-07.md`, `PROGRESS - n8n decommission Phase 0 2026-08-08.md`; MEM-G `reference-kobi-linkedin-profile.md`; OBS `systems/marketplace-profile-kit.md` |
| **UK Podcast Industry Roundtable, co-chair** | Co-chair with Chris Baughen (CEO Audio UK); quarterly; members from Spotify, Google, Amazon, Apple, Acast, BBC, Goalhanger, Audioboom, Audio UK and indies; Kobi organised and invited 19 people for the 15 Oct 2026 session (call notes record Chris, Ben Robins (Sound Insights), Rachel Mallender, Ruth Barnes, Kobi); AudioUK x Sound Insights agency deck on UK podcast ad revenue (UK 18p vs US 94p per listener-hour); Kobi's role on the deck is "lighter", do not claim co-authorship | OBS `projects/uk-podcast-roundtable/meeting-2026-10-15-prep.md` and `...-notes.md`; MEM-OA `project_uk_podcast_roundtable.md` |
| **The Podcast Show London 2026 (20-21 May)** | Ticket via Chris Baughen; brief to meet 14 commercial speakers plus a 76-name shortlist; shortlist file `exports/tps-2026-commercial-shortlist.md` | MEM-OA `project_tps_2026_audiouk_baughen.md` |
| **Audio UK webinar** | Not found in any source. Kobi and Chris discussed packaging his podcast and AI workflow services as an AudioUK member benefit and a podcast-dashboard beta (23 Sep catch-up). Ask Kobi (Gap 10). | OBS `projects/uk-podcast-roundtable/meeting-2026-10-15-prep.md` |
| **AI / Claude Code coaching and content** | "One Hour Vibe Coder" build-in-public brand; YouTube system research (vidIQ and 1of10 trials, "Claude Code Starter Kit" video work), Substack; Searchable webinar folder exists. No paid coaching client or attendee numbers found. | KT git subjects (youtube/*); OBS `projects/Searchable Webinar/`, `projects/Kobestarr Digital Substack/`. Ask Kobi (Gap 11) |
| **Product builds** (shipped or in progress) | TrendMine (46 commits since 2026-02-16), FantasyAwards (97 commits since 2026-02-13), recon (210 commits since 2026-04-25), kobestarr-tools monorepo (684 commits since 2026-02-20), Rallie (41), outreach-automation (260). Total about 1,338 commits by author kobestarr since 2025-09-01 across these six repos (counts from `git log --author=kobestarr --since=2025-09-01`, run 2026-10-18). Note kobestarr-tools includes the BPX work above. | git logs under `/Users/kobestarr/Development/One Hour Vibe Coder/` |
| **Other client sites** | Cafe Azul, Greener Grocer, Thallo outreach, BetGames sales automation (SBC Malta enrichment), Simple AI SEO / Kobestarr AI SEO Engine, Flixwatcher, Slipstream, StarWipe (project folders exist; outcomes not summarised here) | OBS `projects/PROJECT-HUB.md`, `projects/BetGames - Sales Automation Project.md`, `projects/Simple AI SEO/` |
| **LinkedIn reactions engine** | Daily automation on a VPS with ramp 100 to 150/day (linkedapi.io + linkdapi) | MEM-OA `MEMORY.md` |

---

## 4. Skills and tools evidenced

| Skill | Evidence | Strength |
|---|---|---|
| Marketing automation (Marketo) | Form/program API work, 14-field lead upsert, UTM governance, SFDC sync debugging (BPX) | Strong (new since CV) |
| Marketing automation (HubSpot, SharpSpring) | On CV (Natcap HubSpot CRM and automation) | CV only, no recent files read |
| Cold email and LinkedIn outbound | Smartlead, HeyReach, Mailead, lemlist, Reoon verification, warm-up lessons, 807-lead and 820+ lead campaigns | Strong |
| AI automation with Claude Code | Claude Haiku lead scoring, Claude-run pipelines, adversarial specialist+checker agent protocol, 300-test products, 1,300+ commits; Claude Partner Network offer review | Strong |
| Make, Zapier | Not evidenced beyond a job-filter note listing them as target skills (MEM-OA `project-contract-job-pipeline.md`) | Unverified, ask |
| n8n | DealFlow "n8n decommission" project (replaced n8n with code) | Weak-to-moderate; ask |
| GoHighLevel | GHL CLI backbone, GHL MCPs for Dealflow, Kobestarr, Stripped, Twiggy, Flixwatcher; Stable Capital deal tracked in GHL | Moderate-strong |
| CRM and data enrichment | Apollo, ZoomInfo, Cognism, Icypeas, GHL, Salesforce sync, Google Sheets | Strong |
| Paid media / PPC | Entain £100k/week; Gold Standard CPC $1.16; BPX LinkedIn Ads (2.81% CTR), Unbounce CRO; Google Ads MCP tooling | Strong history, BPX is modest budget (£100/day) |
| SEO | Proxymity 100% organic growth, Thallo 2x DA, Webflow migration with 244 redirects, Natcap technical SEO | Strong |
| AEO / GEO | Searchable prompt sets, window cleaner AI-search proof, Kobestarr AI SEO Engine, DealFlow AI-citation rules, BPX AI visibility | Strong and distinctive |
| Web build | WordPress (custom theme), Webflow migration oversight, Next.js/Vercel, Supabase | Strong |
| Project management | PRINCE2, Webflow migration plan with budget and vendors, Asana | Strong |
| Reporting / analytics | GA4, Marketing Wire monthly report, KPI tree, Searchable, pipeline attribution | Strong |
| Content, podcast, video | 1,000+ episodes (claim), UFH football podcast and shorts, Descript, Riverside | Strong |
| Mobile app delivery | Rallie, Expo, App Store submission cycle | Moderate |

Do NOT claim ecommerce or Shopify experience (Kobi's standing rule, MEM-G `feedback-honest-proof-matching.md`).

---

## 5. GAPS: questions only Kobi can answer (one-line answers)

1. What was your exact job title at Bluprintx, and what month and year did you start?
2. Employed full-time on PAYE, or should the CV say "contract" or "fractional" (and what is the employer name to show: Bluprintx or Bluprint Global Ltd)?
3. Who did you report to (Lee Hackett, Phil, Neil), and how many people were in the marketing team?
4. What was your single biggest measurable win at BPX (pipeline, meetings, leads, hours saved)? Give one number and the period.
5. Pipeline numbers: how many meetings, opportunities or £ of pipeline did the outbound (Smartlead/HeyReach) and event campaigns create, if known?
6. Did the AI Readiness Scorecard generate real leads, and roughly how many since launch?
7. Natcap: is the figure 1 to 20 leads a week (2,000%) or 1,900%, and are you still engaged there? Gold Standard: what is the true end date?
8. Which tools did you personally own at BPX (Marketo admin or just API, HeyReach, Smartlead, Searchable, Oktopost, LinkedIn Ads)?
9. Can I quote a manager or colleague (a line from Lee, Phil, Neil or Cedric) with permission to name them?
10. Audio UK webinar: did you present or host one, when, and how many attended?
11. Claude Code / AI coaching: any paid clients, workshops or talks (name, date, headcount)?
12. Are you free to say "Salesforce and Adobe partner" and name EFEX, Domino's or Adobe on the CV, or is anything under NDA or a non-solicit that stops it?

---

## 6. Suggested CV variants by job spec

- **Marketing automation / CRM:** Lead with BPX: Marketo + Salesforce lead pipeline (15-minute LinkedIn lead polling, Claude ICP scoring, Teams routing), AI Readiness Scorecard feeding 14 Marketo fields, then Natcap HubSpot; add GHL and Mailead automation. Put the tool list (Marketo, HubSpot, Salesforce, GHL, Apollo) in the first third.
- **Paid media / PPC:** Lead with Entain £100k/week (£5.2M/yr) and Gold Standard CPC $1.16 and +30% traffic; BPX LinkedIn Ads 2.81% CTR and Unbounce CRO audit as current-role proof; Natcap Google and LinkedIn Ads. Be honest that BPX spend is small (£100/day).
- **AI automation / Claude:** Lead with Claude-scored lead pipeline at BPX, Signal Engine, Claude Partner Network offer review, 300-test AI Readiness product and the adversarial-checker method, plus about 1,300 commits in 6 repos since Sep 2025. Name Claude Code, APIs, VPS, cron, MS Graph. Only list Make, Zapier or n8n if Kobi confirms (Gap 8, section 4).
- **SEO / AEO:** Lead with AEO: Searchable prompt sets (GB/US/AU), window-gutter-clean AI-search proof, DealFlow AI-citation content rules, Webflow migration with 244 redirects, then Proxymity 100% organic and Thallo 2x domain authority.
- **Fractional marketing ops:** Lead with the concurrent fractional model (Natcap, Gold Standard, Kobestarr Digital) plus BPX as embedded GTM-engineering owner (outbound channel, operating model, Marketing Wire, KPI tree). Emphasise "augments the team in the background" and measurable systems, not a head-of title (matches his stated target roles in MEM-OA `project-contract-job-pipeline.md`).

Rule for all variants: match the CV company to the job, state fit honestly, and no ecommerce claims.
