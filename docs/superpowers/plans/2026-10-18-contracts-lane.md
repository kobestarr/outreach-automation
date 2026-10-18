# Contracts lane plan (2026-10-18)

Goal: for each good remote contract role Kobi could do, find the most likely hiring manager and a verified email, so Kobi emails them directly instead of applying cold. Zero paid API spend. Daily Reoon credits only, capped at 150 per run, reserve never used, Icypeas cap 0.

## Units (shared/outreach-core/contracts/)
1. role-filter.js: normalise rows from three shapes (new roles CSV, JobSpy spike CSV, Recon hirewire export) into one role object; keep direct employers, remote, contract/fractional/freelance, not Head/Lead/Senior/Director/Chief/VP/Principal, score >= 5 when a score exists (non-UK roles are capped at 5 upstream and flagged, not dropped); recruiters go to a separate list; dedupe by company.
2. company-domain.js: employer's own domain from ad fields, description, apply URL, then a name-slug guess, then an injected search. Every non-ad domain is verified by fetching the homepage and matching the company name in title / site name. Job-board and ATS domains are rejected. Recon's company_domain is a name-slug guess, so it is verified, never trusted.
3. hiring-manager.js: (a) manager named in the ad, (b) team/about/leadership page person who owns the function (founder/CEO for firms under ~20 staff), (c) Companies House longest-serving active director for small UK companies. Returns {name, title, source, confidence, evidence}.
4. pipeline.js: orchestration with injected deps (fetch, search, CH, finder, clock). Exclusions: data/do-not-contact.txt and data/sent-ledger.txt (OA_DATA_DIR). Finder statuses: found / found_flagged / high-confidence catch-all go to send; found_generic and everything else go to the held file with a reason. Dry run makes zero finder calls.
5. contracts-lane.js CLI: --in --out --dry-run --max-credits (default and hard cap 150) --desc-from.

## Tests first
Fakes for every unit: ad-named manager parsing, team-page pick, founder fallback for small firms, CH fallback, ATS domain rejection, agency rows routed out, DNC exclusion, dry run zero finder calls.

## Out of scope
No sending, no Mailead load, no job-board logins, no Recon changes.
