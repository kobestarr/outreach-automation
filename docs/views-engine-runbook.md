# Runbook: daily-profile-views.js

**Cron:** `15 8 * * *` on clawdbot, `/root/linkedin-reactions/`.
Reactions runs at 07:45; views is staggered 30 minutes behind it.
**Deployed and checksum-verified 2026-08-20.**

## Daily check

```bash
ssh clawdbot 'tail -5 /root/linkedin-reactions/data/profile-views-$(date +%F).log'
```

Expect:

```
Daily profile views | day N | daily cap C | week left W | firing F
linkedapi usage: daily X/200, weekly Y/560
Sources: cache 8463, post authors 5071, 1st-degree 2978, blocklist 4
Queue: 7744 eligible | today's slice by pool: {"views-active":10}
  ✓ [n/C] (views-active) Name GB 1234f
```

**Verify the cap from this log line, never by reading the source.** The JSON
config overrides the JS defaults (handover section 2.1).

## Stop it

```bash
ssh clawdbot 'echo manual > /root/linkedin-reactions/data/STOP-profile-views'
```

Remove the file to resume. **This STOP file is NOT shared with the reactions
engine**, whose file is `data/reactions-daily.STOP`.

## The ramp

`base 10, step 5, ceiling 80`. Fourteen days to reach 80/day.

The binding constraint is the **weekly 560**, not the daily 200. 560/7 = 80
exactly, so there is no slack and the engine enforces a rolling trailing-7-day
budget alongside the daily cap. Kobi's call 2026-08-20: hold at 80 until
fourteen clean days are on the board, then consider raising the weekly cap via
`limits.set`. Evidence before volume.

## Live quota

```bash
curl -s -X POST https://api.linkedapi.io/admin/limits.getUsage \
  -H "Content-Type: application/json" \
  -H "linked-api-token: $(node -e 'console.log(require(process.env.HOME+"/.credentials/api-keys.json").linkedapi_io.apiKey)')" \
  -d "{\"accountId\":\"$(node -e 'console.log(require(process.env.HOME+"/.credentials/api-keys.json").linkedapi_io.accountId)')\"}"
```

`accountId` lives in `~/.credentials/api-keys.json` under `linkedapi_io.accountId`,
**on both the laptop and the VPS**. If it is missing the engine still runs but
`getUsage` fails open and the ramp loses its governor. The symptom is a missing
`linkedapi usage:` line in the log.

## Expected credit spend

**Zero.** The linkdapi/Renidly client is not wired into this engine at all, so it
is structurally incapable of billing. A `workstream:"views"` row in
`data/credit-ledger.jsonl` is an alarm and triggers a WhatsApp message.

## The shared workflow queue (important)

linkedapi runs **one workflow at a time per account**. Likes and views have
separate rate-limit budgets but share a single execution queue.

This is not theoretical. On 2026-08-20 ad-hoc probe workflows fired during a live
reactions run queued ahead of its `reactToPost` workflows, pushed three past its
180-second poll budget, tripped its 3-consecutive-failure breaker, halted it at
83/190 and wrote a STOP file. 107 likes were lost.

Mitigations in the engine: it is strictly sequential, and while
`daily-reactions-batch.js` is running it widens view spacing by
`yieldToReactionsFactor`. **Never fire ad-hoc linkedapi workflows while the
reactions engine is running.** Check first:

```bash
ssh clawdbot 'ps -eo pid,command | grep "[d]aily-reactions-batch.js" || echo idle'
```

Note `pgrep -f daily-reactions-batch.js` **self-matches** its own command string
over ssh and reports a false positive. Use the `ps | grep "[d]..."` form above.

## If it reports limitExceeded

That is the number we were ramping to find. The ramp freezes automatically at
10% below it, the day ends cleanly, and **no STOP file is written** (that would
block tomorrow and the watchdog). Record the number in the spec. Nothing to do.

## If it reports RESTRICTION

Stop. A STOP file has been written and a WhatsApp sent. Do **not** clear it
without checking the LinkedIn account in a browser first. This is the failure
mode that kills the seat.

## Measurement

- `data/profile-enrichment.jsonl` — one line per view: urn, countryCode,
  followers, headline, position, companyName, about. Free profile data that a
  later change will use to warm the reactions engine's resolve cache.
- `data/profile-viewers.jsonl` — `st.retrieveProfileViewers` output, appended
  daily. **This is the direct measurement of the view-back loop**, far sharper
  than waiting 21 days for credited connections. Without LinkedIn Premium,
  LinkedIn shows only part of the list.
- Attribution: targets carry `views-*` pool labels, so
  `reaction-attribution-run.js` separates view-sourced from like-sourced
  connections with no changes.

Baseline to beat, 18 Aug: 2,404 likes to 12 credited connections (0.5%).

## Open

- **`st.reactToComment` bucket.** Unknown whether it draws from `stReactions`
  (so comment-likes would be a reallocation of the existing 200/day, not extra
  volume) or its own budget. A one-shot probe is scheduled:
  `30 20 20 8 *` running `probe-comment-bucket.js`, output in
  `data/comment-probe.log`. **Remove that cron line once it has run.**
- **`nvPersonProfileViews` is 1000/day, 7000/week**, a third independent pool
  12x the standard one. Needs a Sales Navigator seat.
