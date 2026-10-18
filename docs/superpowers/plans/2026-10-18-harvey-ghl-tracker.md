# Plan: GHL cold-email tracker (2026-10-18)

Architecture rule: Mailead sends, GHL tracks (single record, never sends), Buzz notifies.
Spec: docs/spec-reply-funnel-2026-10-18.md section 3.

## API facts (live docs read 18 Oct 2026)
- Base https://services.leadconnectorhq.com, Version header 2021-07-28 (docs label it "v3").
- Pipelines CAN be created: POST /opportunities/pipelines {name, stages[]} (docs list scopes nowhere; the token needs opportunities write).
- Upsert contact overwrites tags, so tags are added afterwards with POST /contacts/:id/tags.
- Opportunity search GET /opportunities/search (locationId, pipelineId, contactId, status). Update PUT /opportunities/:id. Notes POST/GET /contacts/:id/notes.

## Tasks (each: failing test first, then code, then commit)
1. Credentials loader (vault ghl.<brand>, then ~/.claude.json MCP headers, never logs values). Tests: vault wins, MCP fallback, missing brand error, no token in error text.
2. brandForMailbox. Tests: 9 domains, subdomain, case, display-name form, unknown -> kobestarr.
3. HTTP core: timeout, retry 429/5xx with Retry-After and backoff, clear errors without tokens. Tests: 429 then 200, 500 exhausted, 400 not retried, timeout.
4. trackReply: upsert, tags, find or create opportunity, stage by label, note, trimming. Tests per label.
5. No backwards moves, Won frozen, Lost via status, reopen after lost creates a new deal.
6. Idempotency (note marker, no duplicate opp). Dry run = zero calls. Auto = no-op.
7. moveStage(email, brand, stage).
8. ensurePipelines: check, plan, apply (never moves or edits an existing wrong pipeline).
9. ghl-setup.js CLI (--check, --plan, --apply, --brand). Live --check read only.
10. Setup doc (not needed, API can create) and user guide docs/user-guides/ghl-tracking.md.

## Amendment (coordinator, 18 Oct): CLI first
Use the LeadGen Jay CLI (gohighlevel-cli, `ghlp <brand> --json ...`) through an injected exec for everything it covers: list pipelines, list opportunities, create and update opportunity, add tags. Raw fetch only for gaps: create pipeline, contact upsert, find contact by email, notes read and write, and an opportunity search by contact when the CLI page (100) may be full. Tests use a fake exec that maps CLI args to the same fake GHL.
