# Plan: reply engine (Harvey), 2026-10-18

Spec: `docs/spec-reply-funnel-2026-10-18.md` section 2. Branch `feat/harvey-replies`. Test first, every task. Nothing sends email; live calls only behind injected deps in the CLI.

Fixture note: `tests/fixtures/replies-2026-10-18.jsonl` has 48 rows (the brief said 50): 11 warm, 4 maybe, 1 referral, 4 no, 25 auto, 3 left_company.

## Tasks

1. **Plan + config** (this file, `config/harvey.json` with empty `bookingUrl`). Test: none (docs/config).
2. **Mailbox and brand map** `replies/mailboxes.js`: the 27 sending mailboxes, `isOurMailbox`, `brandOf`. Tests: 27 distinct, brand per domain, case-insensitive, own-address detection.
3. **Deterministic classifier** `replies/classify.js` `classifyDeterministic`: headers, multilingual subject patterns, ticket systems, canned responders, left-company, retired, firm unsubscribes, warm guard. Tests: all fixture rows (zero wrong where it decides, coverage reported), Rob threat is not no, Conor not-now is not no, Donna is not decided as no, non-English autos, resume date parsing, colleague extraction.
4. **LLM classifier** `classifyReply` + `replies/llm.js` (Anthropic Messages API, plain fetch). Tests with fake llm and fake fetch: JSON parsing, bad output falls back to maybe, safety downgrade (llm says no/auto on a positive reply becomes maybe), request shape.
5. **Eval script** `scripts/eval-classifier.js` (not run live). Test: runs with fake llm through the same function.
6. **Block everywhere** `replies/block.js`. Tests: all three targets hit, idempotent file appends, only no/left_company, one failure does not stop the others, line format.
7. **Drafting** `replies/draft.js`. Tests: house style (no dashes), booking placeholder, data-source line for Rod, proof point present, lastName never in prompt.
8. **Alert formatting** `replies/format.js`. Tests: fields present, trimmed, no lastName carrier, no %%.
9. **Engine** `replies/engine.js` `processNew`. Tests: Atif case, Rob warm, Conor no block, Donna maybe, Rod data source, block once, 24h re-alert once, OOO resume date, non-English auto, webhook plus Gmail matching, tracker called, tracker failure does not break the run, dry deps.
10. **CLI + LaunchAgent** `reply-engine.js`, `reply-engine.sh`, plist (not loaded). Test: dry-run on fixtures prints actions, writes nothing.
11. **VPS collector** `vps/reply-collector.py` with unittest fakes for imaplib. Not deployed.
12. **User guide** `docs/user-guides/reply-engine.md`.

## Safety rules
No sends, no live Mailead writes, GHL, Anthropic or Buzz in tests. Dry-run stubs the LLM unless `--live-llm` is given.
