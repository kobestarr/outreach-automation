#!/usr/bin/env node
/**
 * weekly-post-report.js — Friday report: which posts penetrated most on
 * LinkedIn this week (from data/posts-seen.jsonl, captured for free during
 * daily resolution — every entry was a post we already paid 1 credit to see).
 *
 * All entries reconcile to the same 7-day window (seenAt within the last 7
 * days of the run), regardless of which day each person was polled — the
 * weekly-TTL polling smears collection across the week, the report does not.
 *
 * Output: data/post-report-YYYY-MM-DD.md (full) + WhatsApp top-5 summary.
 * Also prunes ledger entries older than 30 days.
 * Cron (VPS): 0 8 * * 5
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const ROOT = __dirname;
const LEDGER = path.join(ROOT, "data/posts-seen.jsonl");
const log = (m) => console.log(`[report ${new Date().toISOString().slice(11, 19)}] ${m}`);

function whatsapp(message) {
  try {
    const token = fs.readFileSync("/root/.trendmine-internal-token", "utf8").trim();
    execFileSync("curl", ["-s", "-m", "20", "-X", "POST", "-H", `X-Internal-Token: ${token}`, "-H", "Content-Type: application/json", "-d", JSON.stringify({ to: "447989746146", message, source: "weekly-post-report" }), "http://localhost:3848/send-direct"], { timeout: 30000 });
  } catch (e) { log("whatsapp failed: " + e.message); }
}

if (!fs.existsSync(LEDGER)) { log("no ledger yet — nothing to report"); process.exit(0); }
const lines = fs.readFileSync(LEDGER, "utf8").split("\n").filter(Boolean);
const now = Date.now();
const weekAgo = now - 7 * 864e5;
const monthAgo = now - 30 * 864e5;

const all = [];
const keep = [];
for (const l of lines) {
  try {
    const e = JSON.parse(l);
    const t = new Date(e.seenAt).getTime();
    if (t >= monthAgo) keep.push(l);
    if (t >= weekAgo && e.postUrl) all.push(e);
  } catch {}
}
// prune ledger to 30 days so it never grows unbounded
if (keep.length < lines.length) fs.writeFileSync(LEDGER, keep.join("\n") + "\n");

// dedupe by postUrl, keeping the sighting with the highest engagement
const byUrl = new Map();
for (const e of all) {
  const prev = byUrl.get(e.postUrl);
  if (!prev || (e.reactions || 0) > (prev.reactions || 0)) byUrl.set(e.postUrl, e);
}
const posts = [...byUrl.values()].filter((e) => e.reactions !== null);
posts.sort((a, b) => ((b.reactions || 0) + 2 * (b.comments || 0)) - ((a.reactions || 0) + 2 * (a.comments || 0)));

const range = `${new Date(weekAgo).toISOString().slice(0, 10)} to ${new Date(now).toISOString().slice(0, 10)}`;
const top = posts.slice(0, 15);
const fmt = (e) => `- **${e.reactions || 0} reactions, ${e.comments || 0} comments, ${e.reposts || 0} reposts** — ${e.author || "?"} (${e.source}${e.keyword ? `: "${e.keyword}"` : ""})\n  ${e.postUrl}\n  > ${(e.text || "").replace(/\s+/g, " ").slice(0, 200)}`;

const md = [
  `# Weekly LinkedIn post report — ${range}`,
  ``,
  `Posts seen this week: ${byUrl.size} (${posts.length} with engagement data) across pools + search.`,
  ``,
  `## Top posts by penetration (reactions + 2x comments)`,
  ``,
  ...top.map(fmt),
  ``,
  `## Notes`,
  `- "source: pool" = someone in a warm pool (campaign/ksd/press/cardio/prosp); "source: search" = ICP keyword search.`,
  `- Ask a Claude session for the "why" analysis: patterns in hooks, topics, formats across the top posts.`,
].join("\n");

const outPath = path.join(ROOT, `data/post-report-${new Date().toISOString().slice(0, 10)}.md`);
fs.writeFileSync(outPath, md);
log(`report written: ${outPath} (${posts.length} posts in window)`);

const top5 = top.slice(0, 5).map((e, i) => `${i + 1}. ${e.reactions || 0}r/${e.comments || 0}c — ${e.author || "?"}: ${(e.text || "").replace(/\s+/g, " ").slice(0, 70)}`).join("\n");
whatsapp(`Weekly LinkedIn post report (${range}):\n${posts.length} posts tracked. Top 5 by penetration:\n${top5}\nFull report: /root/linkedin-reactions/data/post-report-${new Date().toISOString().slice(0, 10)}.md`);
