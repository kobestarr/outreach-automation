# Reply Capture — Bombproof Spec

**Created:** 2026-06-22. Goal: make outreach reply-capture so robust that a warm lead can never be silently lost. Design agreed with Kobi: match on our ~10 SENDING addresses (9 Mailead KSD boxes + Lemlist), not on a growing recipient allowlist.

**Why bombproof matters here:** reply-capture failures are invisible. You don't notice a missed reply; you just never hear from a warm lead. So every failure mode must be either prevented or made loud.

## Four guarantees

### 1. Catch every real reply (no silent misses)
| Risk | Hardening |
|---|---|
| Forwarding from a KSD box silently stops | **Read the 9 boxes directly via IMAP** (app password each). No forward to break. |
| Downtime > scan window → permanent miss | Scan from **last-successful-run timestamp** (persisted), not a fixed `--days 3`. |
| Header-match gaps (To vs Cc vs Delivered-To) | Match across `To`/`Cc`/`Delivered-To`/`X-Forwarded-For`/`X-Original-To`, case-insensitive substring on each box. **Validate with one real forwarded reply.** |
| Box list drifts (new sending domain added) | Keep the sending-box list in one config; review when mailboxes change (rare, unlike leads). |

### 2. Never pollute GHL
| Risk | Hardening |
|---|---|
| **Warmup traffic** (Mailead warms boxes by mailing between them) — could flood GHL with fake leads. | **VERIFY FIRST, don't assume.** Boxes warmed ~1yr (Kobi), so reputation is set, but that ≠ whether warmup is still running. Check: (a) is warmup toggled ON in Mailead now? (b) does Mailead auto-archive warmup OUT of INBOX (then watcher never sees it)? If warmup is off OR auto-filed → non-issue. If on AND in-inbox → drop mail from our own boxes / warmup pool / warmup headers. |
| Auto-replies, OOO, bounces | Skip `Auto-Submitted: auto-replied`, `Precedence: bulk/auto_reply/junk`, `mailer-daemon`, `no-reply@`, OOO subjects. |
| Wrong-brand reply into KSD GHL | Only KSD campaign boxes feed this watcher; router is pinned to Kobestarr Digital location. |

### 3. Never double-count
| Risk | Hardening |
|---|---|
| Lost/rotated state file → re-route everything | Contacts upsert (safe). **Make opportunity creation idempotent:** check for existing OPEN opp for contact+pipeline before creating. |
| Overlapping cron runs | Lockfile; skip if a run is in progress. |
| State cap (last 8,000 Message-IDs) drops old IDs | Fine at reply volumes; revisit only if volume spikes. |

### 4. Always know if it breaks (dead-man's switch)
| Risk | Hardening |
|---|---|
| Gmail/IMAP auth dies, cron stops → fails silently forever | **Heartbeat:** if no successful run in N hours, WhatsApp an alert. |
| Repeated auth failure | Alert instead of exiting quietly. |
| WhatsApp bridge down | Router already continues + creates the GHL contact (durable record). Add a retry; GHL is the fallback source of truth. |
| GHL API 5xx | Retry with backoff (currently single attempt). |

## The design decision (pick one)
- **A) Direct IMAP on the 9 boxes** + warmup/auto filter in the watcher. Most control, no forwarding dependency. Needs 9 app passwords. **Recommended.**
- **B) Forwarding → one inbox + Gmail filter** that labels real replies (excludes warmup), watcher reads only that label. Offloads filtering to Gmail; depends on forwarding staying alive.

## Build order (after the 81 launch)
1. Confirm where Mailead replies actually land (real mailbox vs only Mailead unibox) — capture one real reply and inspect headers. **Everything depends on this.**
2. **Verify warmup status** (Mailead toggle + does warmup hit INBOX). If live & in-inbox, build the warmup filter; otherwise skip it. Build the auto-reply/OOO/bounce filter regardless (cheap hygiene).
3. Switch watcher to sending-box matching (Option A), scan-from-last-success, lockfile.
4. Idempotent opportunity creation in `ghl-router.js`.
5. Heartbeat + auth/bridge alerting.
6. Retire `sync-allowlist.js` / the allowlist once sending-box matching is proven.

## Until then
The current allowlist watcher is live and works for the launch. Keep it as the fallback until the sending-box version is proven against real replies. Do not retire it on faith.
