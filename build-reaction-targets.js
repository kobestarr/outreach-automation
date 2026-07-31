#!/usr/bin/env node
/**
 * build-reaction-targets.js — resolve latest-post URLs for reaction warming.
 *
 * Input: a Lemlist export CSV (linkedinUrl column) — default: the cardiologist
 * campaign export. Skips bounced/replied leads, prioritises openers.
 * Resolution via linkdapi (curl + browser UA — plain https gets Cloudflare 403):
 *   /profile/username-to-urn?username=  →  /posts/all?urn=&start=0&count=3
 * Keeps posts newer than --max-age-days (default 60). Output CSV has post_url
 * column so linkedin-react-runner.js needs zero reads at fire time.
 *
 * Usage: node build-reaction-targets.js [in.csv] [--limit 60] [--max-age-days 60]
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const keys = require(path.join(os.homedir(), ".credentials/api-keys.json"));
const LK = keys.linkdapi.apiKey;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const args = process.argv.slice(2);
const SRC = args.find((a, i) => !a.startsWith("--") && (i === 0 || !args[i - 1].startsWith("--"))) ||
  "/private/tmp/claude-501/-Users-kobestarr-Development-One-Hour-Vibe-Coder-outreach-automation/3d648c93-5a14-4c0d-bf26-27559f132ac1/scratchpad/cardio-leads.csv";
const get = (f, d) => { const i = args.indexOf(f); return i >= 0 ? parseInt(args[i + 1], 10) : d; };
const LIMIT = get("--limit", 60);
const MAX_AGE_DAYS = get("--max-age-days", 60);
const OUT = path.join(__dirname, "data", `reaction-targets-${path.basename(SRC, ".csv").replace(/[^a-z0-9-]/gi, "")}.csv`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function curlJson(url) {
  try {
    const out = execFileSync("curl", ["-s", "-m", "25", "-A", UA, "-H", `X-linkdapi-apikey: ${LK}`, url], { encoding: "utf8" });
    return JSON.parse(out);
  } catch { return null; }
}

function parseCSV(text) {
  const rows = []; let cur = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"' && text[i+1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true; else if (c === ",") { cur.push(f); f = ""; }
    else if (c === "\r") {} else if (c === "\n") { cur.push(f); rows.push(cur); cur = []; f = ""; }
    else f += c; }
  if (f.length || cur.length) { cur.push(f); rows.push(cur); }
  const h = rows.shift();
  return rows.filter((r) => r.some((v) => v && v.trim())).map((r) => Object.fromEntries(h.map((k, i) => [k, (r[i] || "").trim()])));
}

(async () => {
  const rows = parseCSV(fs.readFileSync(SRC, "utf8"));
  // warmest first: opened > sent; skip bounced + replied
  const liKey = Object.keys(rows[0] || {}).find((k) => /linkedin/i.test(k)) || "linkedinUrl";
  const eligible = rows
    .filter((r) => (r.lastState ? ["emailsSent", "emailsOpened"].includes(r.lastState) : true) && r[liKey])
    .map((r) => ({ ...r, linkedinUrl: r[liKey], firstName: r.firstName || (r.name || "").split(" ")[0], lastName: r.lastName || (r.name || "").split(" ").slice(1).join(" ") }))
    .sort((a, b) => (b.lastState === "emailsOpened") - (a.lastState === "emailsOpened"));
  console.log(`${rows.length} rows → ${eligible.length} eligible (non-bounced, non-replied, has LinkedIn)`);

  const state = fs.existsSync(path.join(__dirname, "data/linkedin-reacted-state.json"))
    ? JSON.parse(fs.readFileSync(path.join(__dirname, "data/linkedin-reacted-state.json"), "utf8")).reacted : {};
  const cutoff = Date.now() - MAX_AGE_DAYS * 864e5;
  const targets = [];
  let tried = 0, noUrn = 0, noPost = 0, stale = 0;

  for (const r of eligible) {
    if (targets.length >= LIMIT) break;
    const username = (r.linkedinUrl.match(/linkedin\.com\/in\/([^/?#]+)/i) || [])[1];
    if (!username) continue;
    tried++;
    if (tried % 10 === 0) console.log(`  ...tried ${tried} profiles (targets so far: ${targets.length})`);
    const urnRes = curlJson(`https://linkdapi.com/api/v1/profile/username-to-urn?username=${encodeURIComponent(username)}`);
    const urn = urnRes?.data?.urn;
    if (!urn) { noUrn++; await sleep(900); continue; }
    const postsRes = curlJson(`https://linkdapi.com/api/v1/posts/all?urn=${encodeURIComponent(urn)}&start=0&count=3`);
    const posts = postsRes?.data?.posts || postsRes?.data || [];
    const ts = (p) => p.postedAt?.timestamp || (typeof p.postedAt === "string" ? new Date(p.postedAt).getTime() : 0);
    const post = (Array.isArray(posts) ? posts : []).find((p) => p.url && (!p.postedAt || ts(p) > cutoff));
    if (!post) {
      const any = (Array.isArray(posts) ? posts : []).find((p) => p.url);
      any ? stale++ : noPost++;
      await sleep(900); continue;
    }
    if (state[post.url]) { await sleep(900); continue; }
    targets.push({ name: `${r.firstName} ${r.lastName}`, linkedin_url: r.linkedinUrl, post_url: post.url, posted_at: post.postedAt?.fullDate || "", email_state: r.lastState });
    console.log(`  ✓ [${targets.length}/${LIMIT}] ${r.firstName} ${r.lastName} (${r.lastState}) → ${post.url.slice(0, 70)}`);
    await sleep(900);
  }

  const cols = ["name", "linkedin_url", "post_url", "posted_at", "email_state"];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  fs.writeFileSync(OUT, [cols.join(","), ...targets.map((t) => cols.map((c) => esc(t[c])).join(","))].join("\n"));
  console.log(`\nResolved ${targets.length} targets (tried ${tried}: no-urn ${noUrn}, no-posts ${noPost}, stale-only ${stale})`);
  console.log(`OUT: ${OUT}`);
})();
