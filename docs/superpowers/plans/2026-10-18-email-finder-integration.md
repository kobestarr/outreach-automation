# Email finder integration: implementation plan

**Spec (binding):** `docs/superpowers/specs/2026-10-18-email-finder-integration-design.md`, including "Revisions after adversarial review", which override the earlier text.
**Branch:** `feat/ef-finder` (worktree `oa-wt-finder`). Finder change on `feat/_kobestarr-email-finder` in kobestarr-tools.
**Method:** every task writes its failing tests first (red), then the code (green), then a small commit. Injected fakes only: no network, no credits, no sheets, no Mailead. Test style follows `tests/buzz-alerts.test.js`.
**Run:** `PATH="/usr/local/bin:$PATH" node --test tests/*.test.js` (baseline 93 of 94, `reaction-icp-gate` already fails and is ignored).

## Task 0: plan
This file.

## Task 1: finder `lastVerified` and `isSuppressed` (kobestarr-tools)
Files: `engines/email-finder/src/store.js`, `index.js`, `test/store.test.js`, `test/index.test.js`.
Failing tests first:
- store `lastVerification(email)` returns `{status, verified_at}` inside 30 days, null at 30 days, null for a bounced address, null for never-cached.
- finder `lastVerified()` is case-insensitive and read only (no Reoon call, no row written).
- finder `isSuppressed()` is true for an exact email, for a bare domain, and for any address at a suppressed domain; false otherwise; false for empty input.
- both exist on the object `createEmailFinder` returns.

## Task 2: adapter `shared/outreach-core/enrichment/email-finder-adapter.js`
Failing tests: path order (EMAIL_FINDER_HOME, worktree, engines), skips a dir lacking `cli.js` or `node_modules`, error names every path tried; `openFinder` forces `useReserve:false` even if the caller passes true; missing, null or NaN `maxIcypeas` becomes 0; `defaultMaxCredits(balance, 300)` is daily minus 300, never below 0; `openFinderBounded` probes the balance once, then opens with the computed cap, and an explicit `maxCredits` skips the probe.

## Task 3: `chooseOwnerEmail` in `owner-email.js`
Failing tests, one per row of the precedence list plus: scraped owner beats everything and finder is irrelevant; finder personal beats scraped role; scraped role beats finder generic; finder generic beats scraped staff; scraped staff beats Icypeas probable; probable alone is chosen with low confidence; scraped non-owner freemail dropped; `left_company` never chosen even though it has an email (choose by status, not by non-empty email); `suppressed` removes the row even when a scraped role exists; finder error keeps scraped role as `scraped_role`; `email_suggested` is copied through and never becomes `email`; rules are `finder-found` and `finder-generic`; `resolveOwnerEmail` still exported.

## Task 4: `enrichRows` in `enrich-owner-emails.js`
Failing tests: finder skipped for owner-match and owner-freemail; called only with owner name AND `maps_match` yes or probable (not check, not no); one `findMany` call for all rows that need it (two phases); company-only rows with a website but no owner name never reach the finder; `--no-guess` skips the finder; resume reuses scrape records without re-scraping; only FINAL statuses count as done on resume; `error`, `skipped`, `not_run`, `retry_later` re-run; records carry `v:2` and v1 records are ignored; finder throws for the whole batch: scraped picks kept, rows marked `error`; budget exhausted: scraped picks kept and a re-run count reported; report counts by status and rule plus credits; CSV has the new columns and keeps existing ones; `--max-credits` defaults to daily minus 300 and `--max-icypeas` to 0 (argument parser unit).

## Task 5: assemble pass-through
Failing tests (run the script on a temp CSV as a child process): `email_status`, `email_confidence`, `email_source`, `email_rule` survive; `email_suggested` is dropped; a file with no `email_status` column produces none (legacy stays legacy); a file with the column and a blank value keeps the blank column; nickname greeting works for `finder-found`.

## Task 6: `finder-route.js` `routeFor`
Failing tests: every status in the table; confidence high versus low versus missing for catch-all and Icypeas; empty email always excluded; legacy (no column) is main; column present with blank value is excluded (fail closed); `email_suggested` never read; whitespace and case tolerant; reads `lead.ref` as produced by `normalise`.

## Task 7: send-batch guards (new `send-guards.js`) and runBatch
Failing tests, each with fake sheets, fake verify and a fake finder:
- `resolveDataDir`: env wins; default is the main checkout; a live run from a worktree without `OA_DATA_DIR` refuses; a dry run from a worktree is allowed.
- do-not-contact by email and by domain, with comments and tab reasons; applies to scraped rows.
- finder `isSuppressed` removes a row at the last gate whatever its source; live run with no finder refuses.
- firm dedupe in file by domain and by company number, across routes, keeping the best route; freemail domains never match; company ledger written at push (`company_number<TAB>domain`); a later run skips by company number, by domain, and by a domain seen in any loaded email; ledger seeded from `mailead-loaded-*.txt`.
- routing: main, inbox and probable go to their configured campaign keys; unconfigured route writes `held-<key>-<route>.csv` and is reported; excluded rows go to `excluded-<key>-<date>.csv` with reasons; pre-flight aborts with nothing pushed when a route sheet is missing.
- Reoon skip only when `email_source=finder` and `lastVerified` is `safe`, `role_account` or `inbox_full` and under 30 days; other statuses, old stamps, scraped rows, and a finder without `lastVerified` all verify as normal.
- finder balance check before verify: aborts cleanly with nothing pushed when the rows to verify exceed the daily balance.
- `--register` merges into the existing entry and keeps `finderRoutes`.
- existing tests keep passing.

## Task 8: bounce loop in `mailead-alerts-buzz.js`
Failing tests (`handleEvents`): bounce imported once and appended to `bounced.txt`; the same address twice is imported once; addresses already in `bounced.txt` are not re-imported; own mailbox is skipped (parity test against the receiver's `OWN_DOMAIN_HINTS`); alert still posts when the finder fails; failed import queues the address in `bounces-queue.txt` and posts one Buzz notice per run; next successful run drains the queue first; replies are not imported; offset only advances when every event is handled (import or queue succeeded); dry-run touches no file.

## Task 9: benchmark helper `scripts/finder-benchmark.js`
Failing tests: selects exactly the rows the enrich gate would send; prints worst-case credits using the finder's `dryRun`; refuses to write to an `--out` that exists; never opens a finder without `--live`; `--live` path takes an injected finder in tests.

## Task 10: user guide `docs/user-guides/email-finder.md`
Plain English. Reviewed against the final behaviour.

## Definition of done
All new tests green, old tests unchanged apart from `makeIo` gaining a fake finder and data dir, no credits spent, no file written outside the worktree and the finder worktree, no em dashes.
