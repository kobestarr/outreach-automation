#!/usr/bin/env node
/**
 * daily-reactions-batch.js — daily LinkedIn reaction warming via linkedapi.io
 * (reactions ONLY, per the tool-boundary rule: Prosp owns connects/sequences).
 *
 * Ramp: cap = min(base + step × daysSinceStart, ceiling) — config in
 * data/reactions-daily-config.json (created with defaults on first run).
 * Kobi 2026-07-20: start 100, +10/day incl. weekends, hopper must always
 * cover the cap. linkedapi.io's guide caps likes ~100/day even for trusted
 * accounts, hence ceiling + kill switch.
 *
 * HOPPER model (guarantees the cap is hit as it climbs):
 *   - data/reactions-hopper.json holds pre-resolved {postUrl, name, pool}
 *   - fire phase: consume hopper first (stale >72h dropped), then live-resolve
 *   - top-up phase: after firing, resolve ahead until hopper ≥ tomorrow's
 *     cap × hopperMultiplier (or the linkdapi call budget runs out)
 *
 * Target pools, priority order (warm → cold):
 *   1. cardio — Lemlist cardiologist campaign (delivered, non-replied)
 *   2. prosp — leads in the two ACTIVE Prosp invite campaigns (warms invites)
 *   3. press — ufh-journalists + event speakers from DB (high post rate)
 *   4. ksd   — ksd-local-2026 B2B contacts from DB (deep pool, cursor sweep;
 *              cursor advances over CHECKED rows so each run sweeps new ground)
 *
 * Safety (the "test each day" requirement, automated):
 *   - pre-flight GET /account probe; abort + WhatsApp on failure
 *   - halts on restriction-signal errors (limitExceeded/restrict/challenge/auth)
 *   - halts after 3 consecutive workflow failures or >25% failure rate
 *   - kill switch: create data/reactions-daily.STOP to skip runs
 *   - WhatsApp summary to Kobi after every run (and on every halt)
 *
 * Usage:  node daily-reactions-batch.js [--dry-run] [--cap N] [--no-topup]
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const { execFileSync } = require("child_process");

const ROOT = __dirname;
const GATE = require("./reaction-icp-gate.js"); // ICP gate: company pages block, rest shadow-scored
const ATTR = require("./reaction-attribution.js"); // likes -> inbound invites, per pool
const keys = require(path.join(os.homedir(), ".credentials/api-keys.json"));
const CONFIG_PATH = path.join(ROOT, "data/reactions-daily-config.json");
const STATE_PATH = path.join(ROOT, "data/linkedin-reacted-state.json");
const CACHE_PATH = path.join(ROOT, "data/reaction-resolve-cache.json");
const CURSOR_PATH = path.join(ROOT, "data/reactions-ksd-cursor.json");
const HOPPER_PATH = path.join(ROOT, "data/reactions-hopper.json");
const STOP_PATH = path.join(ROOT, "data/reactions-daily.STOP");
const ATTR_PATH = path.join(ROOT, "data/reaction-attribution.json"); // likes -> inbound invites ledger
const BLOCKLIST_PATH = path.join(ROOT, "data/reactions-blocklist.txt"); // one LinkedIn username per line, # comments
const FIRSTDEG_PATH = path.join(ROOT, "data/first-degree-connections.txt"); // auto-refreshed via st.retrieveConnections
const CARDIO_CSV = path.join(ROOT, "data/lemlist-cardiologists-2026-07.csv");
const DB_PATH = path.join(ROOT, "ksd/local-outreach/orchestrator/data/businesses.db");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const DEFAULT_CONFIG = {
  rampStartDate: "2026-07-21",
  base: 100,
  step: 10,
  ceiling: 150,            // hold here; linkedapi guide says ~100/day likes even for trusted accounts
  maxPostAgeDays: 45,
  hopperStaleHours: 72,    // resolved posts older than this are re-verified out
  hopperMultiplier: 1.3,   // top up to tomorrow's cap × this
  throttleMinMs: 35000,    // floor between reactions (anti-burst)
  throttleMaxMs: 90000,    // fallback ceiling when past the spread window
  spreadEndHourUTC: 17,    // meter the day's cap out until ~this hour (17 UTC ≈ 18:00 BST)
  personCooldownDays: 7,   // never react to the same person more than once per this many days
  refreshConnectionsDays: 7, // re-pull 1st-degree connections list this often (excluded from targeting)
  resolveCallBudget: 2500, // linkdapi calls per run (urn + posts + gate overview)
  // ICP gate. Company pages are always blocked. These signals start in SHADOW
  // mode: add a dial key ("country" | "followers" | "excluded-role" |
  // "not-decision-maker") to gateBlockOn to promote it to blocking.
  gateBlockOn: [],
  minFollowers: 300,
  // Attribution: match received invites back to the like that earned them.
  attributionEnabled: true,
  attributionWindowDays: 21,
  ksdFetchMultiplier: 15,  // DB rows fetched per run = cap × this (low post rate expected)
  prospCampaigns: [
    { id: "6eb024a3-27d7-4fbd-bc51-517bd0b9a49b", name: "ICP Genie" },
    { id: "1bd6f6ce-a3d5-40d0-a992-2a7d70b1db55", name: "Medium Warm" },
  ],
  // ICP keyword search (linkdapi /search/posts, past-week): overflow filler so the
  // hopper ALWAYS covers the cap. UK-slanted phrases; rotated 3/day by day-of-year.
  searchKeywords: [
    "UK startup founder", "UK founder hiring", "London startup growth",
    "Manchester business owner", "UK small business marketing", "founder fundraising UK",
    "UK podcast launch", "UK agency owner", "startup marketing UK",
    "UK ecommerce founder", "SaaS founder UK", "UK business website",
  ],
  searchKeywordsPerRun: 3,
  searchPagesPerKeyword: 2,
};

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry-run");
const NO_TOPUP = argv.includes("--no-topup");
const capOverride = argv.includes("--cap") ? parseInt(argv[argv.indexOf("--cap") + 1], 10) : null;
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const loadJson = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; } };
const saveJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2));

const ON_VPS = fs.existsSync("/root/.trendmine-internal-token");
function whatsapp(message) {
  if (DRY) { log(`[dry] WhatsApp: ${message}`); return; }
  const payload = JSON.stringify({ to: "447989746146", message, source: "linkedin-reactions-daily" });
  try {
    if (ON_VPS) {
      const token = fs.readFileSync("/root/.trendmine-internal-token", "utf8").trim();
      execFileSync("curl", ["-s", "-m", "20", "-X", "POST", "-H", `X-Internal-Token: ${token}`, "-H", "Content-Type: application/json", "-d", payload, "http://localhost:3848/send-direct"], { timeout: 30000 });
    } else {
      execFileSync("ssh", ["clawdbot",
        `TOKEN=$(cat /root/.trendmine-internal-token); curl -s -m 20 -X POST -H "X-Internal-Token: $TOKEN" -H "Content-Type: application/json" -d ${JSON.stringify(payload)} http://localhost:3848/send-direct`,
      ], { timeout: 30000 });
    }
  } catch (e) { log(`WhatsApp notify failed (non-fatal): ${e.message}`); }
}

// ---------- linkedapi.io ----------
const LA_HEADERS = {
  "linked-api-token": keys.linkedapi_io.apiKey,
  "identification-token": keys.linkedapi_io.identificationToken,
  "Content-Type": "application/json",
};
function laReq(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const r = https.request({ method, hostname: "api.linkedapi.io", path: urlPath, headers: LA_HEADERS }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => { try { resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString() || "{}") }); } catch { resolve({ status: res.statusCode, json: {} }); } });
    });
    r.on("error", reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}
const RESTRICTION_RE = /limitExceeded|restrict|challenge|checkpoint|banned|unauthoriz|unauthenticated|invalidToken|accountNotConnected/i;
const usernameOf = (url) => { const m = (url || "").match(/linkedin\.com\/in\/([^/?#]+)/i); return m ? decodeURIComponent(m[1]).toLowerCase() : null; };

async function refreshFirstDegree(cfg) {
  // One st.retrieveConnections workflow → data/first-degree-connections.txt.
  // Keeps 1st-degrees out of targeting (incl. new Prosp accepts) within a week.
  const ageMs = fs.existsSync(FIRSTDEG_PATH) ? Date.now() - fs.statSync(FIRSTDEG_PATH).mtimeMs : Infinity;
  if (ageMs < cfg.refreshConnectionsDays * 864e5) return;
  log("Refreshing 1st-degree connections list via st.retrieveConnections...");
  const start = await laReq("POST", "/workflows", { actionType: "st.retrieveConnections" });
  const wfId = start.json?.result?.workflowId;
  if (!wfId) { log(`connections refresh failed to start (non-fatal): ${JSON.stringify(start.json).slice(0, 200)}`); return; }
  for (let i = 0; i < 120; i++) {  // up to 20 min; large networks take a while
    await sleep(10000);
    const p = await laReq("GET", `/workflows/${wfId}`);
    const st = p.json?.result?.workflowStatus;
    if (st === "completed") {
      const comp = p.json.result.completion || {};
      const usernames = (comp.data || []).map((c) => usernameOf(c.publicUrl)).filter(Boolean);
      if (usernames.length) {
        fs.writeFileSync(FIRSTDEG_PATH, `# auto-generated ${new Date().toISOString()} — ${usernames.length} 1st-degree connections\n` + usernames.join("\n"));
        log(`1st-degree list refreshed: ${usernames.length} connections excluded from targeting`);
      } else log(`connections refresh returned no data (non-fatal): ${JSON.stringify(comp).slice(0, 200)}`);
      return;
    }
    if (st === "failed") { log(`connections refresh failed (non-fatal): ${JSON.stringify(p.json.result).slice(0, 200)}`); return; }
  }
  log("connections refresh timed out (non-fatal)");
}

async function reactToPost(postUrl) {
  const start = await laReq("POST", "/workflows", { actionType: "st.reactToPost", postUrl, type: "like" });
  const wfId = start.json?.result?.workflowId;
  if (!wfId) return { ok: false, error: JSON.stringify(start.json).slice(0, 300) };
  for (let i = 0; i < 30; i++) {
    await sleep(6000);
    const p = await laReq("GET", `/workflows/${wfId}`);
    const st = p.json?.result?.workflowStatus;
    if (st === "completed") {
      const comp = p.json.result.completion;
      if (comp && comp.success === false) return { ok: false, error: `${comp.error?.type}: ${comp.error?.message}` };
      return { ok: true };
    }
    if (st === "failed") return { ok: false, error: JSON.stringify(p.json.result).slice(0, 300) };
  }
  return { ok: false, error: "poll timeout" };
}

// ---------- linkdapi (resolution, curl + browser UA for Cloudflare) ----------
let resolveCalls = 0;
// ICP gate telemetry — the daily readout we tune the dials from.
const gateStats = { companyPagesDropped: 0, scored: 0, passed: 0, blocked: 0, reasons: {} };
const gateReport = [];

// One cached linkdapi call → countryCode / followers / industry / headline.
// Never expires: people rarely change country, and the whole point is to stop
// paying to re-learn that a given profile is in Bhopal.
function profileOverview(username, cache) {
  const entry = cache[username] || (cache[username] = {});
  if (entry.profile) return entry.profile;
  const d = linkdapi(`/profile/overview?username=${encodeURIComponent(username)}`)?.data;
  entry.profile = d
    ? { countryCode: d.location?.countryCode || null, followers: d.followerCount || 0, industry: d.industryName || "", headline: d.headline || "" }
    : { unresolved: true };
  return entry.profile;
}
function linkdapi(urlPath) {
  resolveCalls++;
  try {
    const out = execFileSync("curl", ["-s", "-m", "25", "-A", UA, "-H", `X-linkdapi-apikey: ${keys.linkdapi.apiKey}`, `https://linkdapi.com/api/v1${urlPath}`], { encoding: "utf8" });
    return JSON.parse(out);
  } catch { return null; }
}

function resolveLatestPost(linkedinUrl, cache, cfg, state) {
  const username = (linkedinUrl.match(/linkedin\.com\/in\/([^/?#]+)/i) || [])[1];
  if (!username) return null;
  const entry = cache[username] || {};
  if (!entry.urn) {
    if (entry.urnCheckedAt && Date.now() - entry.urnCheckedAt < 14 * 864e5) return null; // known-bad handle, don't re-burn
    const r = linkdapi(`/profile/username-to-urn?username=${encodeURIComponent(username)}`);
    entry.urn = r?.data?.urn || null;
    entry.urnCheckedAt = Date.now();
    cache[username] = entry;
    if (!entry.urn) return null;
  }
  const postsFresh = entry.postsCheckedAt && Date.now() - entry.postsCheckedAt < 48 * 3600e3;
  if (!postsFresh) {
    const r = linkdapi(`/posts/all?urn=${encodeURIComponent(entry.urn)}&count=3`);
    const posts = r?.data?.posts || [];
    const cutoff = Date.now() - cfg.maxPostAgeDays * 864e5;
    const hit = posts.find((p) => p.url && (p.postedAt?.timestamp || 0) > cutoff);
    entry.lastPostUrl = hit ? hit.url : null;
    entry.postsCheckedAt = Date.now();
    cache[username] = entry;
  }
  if (entry.lastPostUrl && !state.reacted[entry.lastPostUrl]) return entry.lastPostUrl;
  return null;
}

// ---------- pools ----------
function parseCSV(text) {
  const rows = []; let cur = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true; else if (c === ",") { cur.push(f); f = ""; }
    else if (c === "\r") {} else if (c === "\n") { cur.push(f); rows.push(cur); cur = []; f = ""; }
    else f += c; }
  if (f.length || cur.length) { cur.push(f); rows.push(cur); }
  const h = rows.shift();
  return rows.filter((r) => r.some((v) => v && v.trim())).map((r) => Object.fromEntries(h.map((k, i) => [k, (r[i] || "").trim()])));
}

function cardioPool() {
  if (!fs.existsSync(CARDIO_CSV)) return [];
  return parseCSV(fs.readFileSync(CARDIO_CSV, "utf8"))
    .filter((r) => ["emailsSent", "emailsOpened"].includes(r.lastState) && r.linkedinUrl)
    .sort((a, b) => (b.lastState === "emailsOpened") - (a.lastState === "emailsOpened"))
    .map((r) => ({ pool: "cardio", name: `${r.firstName} ${r.lastName}`, linkedinUrl: r.linkedinUrl }));
}

function prospLeads(campaignId) {
  // Inline Prosp API call (POST prosp.ai/api/v1/campaigns/leads) — no local module needed.
  return new Promise((resolve) => {
    const body = JSON.stringify({ campaign_id: campaignId, api_key: keys.prosp.apiKey });
    const r = https.request({ method: "POST", hostname: "prosp.ai", path: "/api/v1/campaigns/leads",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString()).data || []); } catch { resolve([]); } });
    });
    r.on("error", () => resolve([]));
    r.write(body); r.end();
  });
}

async function prospPool(cfg) {
  const out = [];
  for (const c of cfg.prospCampaigns) {
    const arr = await prospLeads(c.id);
    for (const l of arr) if (l.linkedinUrl) out.push({ pool: "prosp", name: l.name || "", linkedinUrl: l.linkedinUrl });
  }
  if (!out.length) log("prosp pool empty (non-fatal)");
  return out;
}

// press + ksd pools read CSV snapshots (data/pool-press.csv, data/pool-ksd.csv)
// exported from businesses.db by export-reaction-pools.js — portable to the VPS,
// where better-sqlite3/the DB don't exist. Re-export + re-upload to refresh.
function csvPool(file, poolName) {
  const p = path.join(ROOT, "data", file);
  if (!fs.existsSync(p)) { log(`${poolName} pool snapshot missing (${file}) — skipping`); return []; }
  return parseCSV(fs.readFileSync(p, "utf8"))
    .filter((r) => (r.linkedin_url || "").includes("linkedin.com/in/"))
    .map((r) => ({ pool: poolName, name: r.name || "", linkedinUrl: r.linkedin_url, rowid: r.rowid ? parseInt(r.rowid, 10) : undefined }));
}

function pressPool() {
  return csvPool("pool-press.csv", "press").map((r) => ({ ...r, rowid: undefined }));
}

function searchPool(cfg, state) {
  // Direct reactable posts by ICP keyword — 1 call ≈ 10-25 posts, no URN resolution.
  const out = [];
  const seenAuthors = new Set();
  const mostlyLatin = (t) => { const s = (t || "").slice(0, 200); if (!s) return false; const latin = (s.match(/[A-Za-z0-9\s.,!?'"()\-:;@#&%/]/g) || []).length; return latin / s.length > 0.7; };
  const dayIdx = Math.floor(Date.now() / 864e5);
  const kws = Array.from({ length: cfg.searchKeywordsPerRun }, (_, i) => cfg.searchKeywords[(dayIdx * cfg.searchKeywordsPerRun + i) % cfg.searchKeywords.length]);
  for (const kw of kws) {
    for (let page = 0; page < cfg.searchPagesPerKeyword; page++) {
      const r = linkdapi(`/search/posts?keyword=${encodeURIComponent(kw)}&datePosted=past-week&start=${page * 10}`);
      const posts = r?.data?.posts || [];
      if (!posts.length) break;
      for (const p of posts) {
        const url = p.postURL || p.url;
        const authorKey = p.author?.urn || p.author?.name || url;
        // Company pages can't view back, can't accept a connect, can't buy.
        // 26% of the 2026-07-22 audit sample — the cheapest noise to kill.
        if (GATE.isCompanyAuthor(p.author)) { gateStats.companyPagesDropped++; continue; }
        if (!url || state.reacted[url] || seenAuthors.has(authorKey) || !mostlyLatin(p.text)) continue;
        seenAuthors.add(authorKey);
        out.push({ pool: "search", name: p.author?.name || "(search)", postUrl: url, keyword: kw, linkedinUrl: p.author?.url || "" });
      }
    }
  }
  return out;
}

function ksdPool(limit) {
  const all = csvPool("pool-ksd.csv", "ksd").sort((a, b) => a.rowid - b.rowid);
  const cursor = loadJson(CURSOR_PATH, { lastRowid: 0 });
  let rows = all.filter((r) => r.rowid > cursor.lastRowid).slice(0, limit);
  if (rows.length < limit) rows = rows.concat(all.slice(0, limit - rows.length)); // wrap around
  return rows;
}

// ---------- main ----------
(async () => {
  if (fs.existsSync(STOP_PATH)) { log("STOP file present (data/reactions-daily.STOP) — skipping run."); return; }
  if (!fs.existsSync(CONFIG_PATH)) saveJson(CONFIG_PATH, DEFAULT_CONFIG);
  const cfg = { ...DEFAULT_CONFIG, ...loadJson(CONFIG_PATH, {}) };
  const days = Math.max(0, Math.floor((Date.now() - new Date(cfg.rampStartDate + "T00:00:00Z")) / 864e5));
  const cap = capOverride ?? Math.min(cfg.base + cfg.step * days, cfg.ceiling);
  const nextCap = Math.min(cfg.base + cfg.step * (days + 1), cfg.ceiling);
  log(`Daily reactions batch | day ${days} of ramp | cap ${cap} | next cap ${nextCap}${DRY ? " | DRY-RUN" : ""}`);

  // pre-flight probe
  const probe = await laReq("GET", "/account");
  if (probe.status !== 200 || !probe.json?.success) {
    const msg = `linkedin-reactions: pre-flight FAILED (HTTP ${probe.status} ${JSON.stringify(probe.json).slice(0, 150)}). Run aborted — check app.linkedapi.io seat/login.`;
    log(msg); whatsapp(msg); process.exit(1);
  }
  log(`Pre-flight OK: ${probe.json.result?.name} connected`);

  const state = loadJson(STATE_PATH, { reacted: {} });
  const cache = loadJson(CACHE_PATH, {});
  const blocklist = new Set(
    (fs.existsSync(BLOCKLIST_PATH) ? fs.readFileSync(BLOCKLIST_PATH, "utf8").split("\n") : [])
      .map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith("#"))
  );
  if (!DRY) await refreshFirstDegree(cfg);
  // NOTE: attribution does NOT run here. st.retrieveInvitations was measured
  // running 35+ min (advertised 2-4) on 2026-07-22. linkedapi runs one workflow
  // at a time per account, so a slow retrieval at run start leaves every queued
  // like stuck behind it, each poll timing out into the 3-consecutive-failure
  // halt — the 2026-07-21 outage. It lives in reaction-attribution-run.js on its
  // own cron at 21:30 UTC, after the 20:00 spread window closes.
  const firstDeg = new Set(
    (fs.existsSync(FIRSTDEG_PATH) ? fs.readFileSync(FIRSTDEG_PATH, "utf8").split("\n") : [])
      .map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith("#"))
  );
  const isBlocked = (linkedinUrl) => {
    const u = usernameOf(linkedinUrl);
    return u ? blocklist.has(u) || firstDeg.has(u) : false;
  };
  const personKeyOf = (t) => usernameOf(t.linkedinUrl) || (t.name || "").trim().toLowerCase() || null;
  const onCooldown = (t) => {
    const k = personKeyOf(t);
    const last = k && state.persons?.[k];
    return last ? Date.now() - new Date(last).getTime() < cfg.personCooldownDays * 864e5 : false;
  };
  log(`Exclusions: blocklist ${blocklist.size}, 1st-degree ${firstDeg.size} | person cooldown ${cfg.personCooldownDays}d`);
  state.persons = state.persons || {};
  let hopper = loadJson(HOPPER_PATH, []);
  const staleCutoff = Date.now() - cfg.hopperStaleHours * 3600e3;
  const preStale = hopper.length;
  hopper = hopper.filter((h) => h.resolvedAt > staleCutoff && !state.reacted[h.postUrl]);
  log(`Hopper: ${hopper.length} ready (${preStale - hopper.length} stale/used dropped)`);

  const done = { cardio: 0, prosp: 0, press: 0, ksd: 0, search: 0 };
  let fired = 0, failures = 0, consecFail = 0, attempts = 0, halted = null;

  async function fire(target) {
    // ---- ICP gate. Company pages are already dropped at source; everything
    // here is SHADOW-scored (logged, not blocked) until a dial is promoted via
    // cfg.gateBlockOn. Costs 1 cached linkdapi call per new person. ----
    // Hopper items were stocked a day early, some of them before this gate
    // existed, so company pages still arrive here. Block them at fire time too.
    if (GATE.isCompanyAuthor({ url: target.linkedinUrl })) {
      gateStats.companyPagesDropped++;
      log(`  ⊘ company page (${target.pool}) ${target.name}`);
      return true;
    }
    const gu = usernameOf(target.linkedinUrl);
    if (gu && resolveCalls < cfg.resolveCallBudget) {
      const prof = profileOverview(gu, cache);
      if (!prof.unresolved) {
        const verdict = GATE.icpVerdict(prof, cfg);
        gateStats.scored++;
        if (verdict.pass) gateStats.passed++;
        else for (const r of verdict.reasons) { const d = GATE.dialOf(r); gateStats.reasons[d] = (gateStats.reasons[d] || 0) + 1; }
        gateReport.push({ pool: target.pool, name: target.name, country: prof.countryCode, followers: prof.followers, industry: prof.industry, headline: prof.headline, verdict: verdict.pass ? "PASS" : verdict.reasons.join("+") });
        if (GATE.shouldBlock(verdict, cfg)) {
          gateStats.blocked++;
          log(`  ⊘ gated (${target.pool}) ${target.name}: ${verdict.reasons.join(", ")}`);
          return true; // skipped, not a failure — must not trip the halt breakers
        }
      }
    }
    if (DRY) { log(`  [would LIKE] (${target.pool}) ${target.name} → ${target.postUrl.slice(0, 80)}`); fired++; done[target.pool] = (done[target.pool] || 0) + 1; return true; }
    attempts++;
    const res = await reactToPost(target.postUrl);
    if (res.ok) {
      fired++; done[target.pool] = (done[target.pool] || 0) + 1; consecFail = 0;
      state.reacted[target.postUrl] = new Date().toISOString();
      const pk = personKeyOf(target);
      if (pk) {
        state.persons[pk] = new Date().toISOString();
        // Remember WHICH pool/keyword earned this like, so an invite arriving
        // days later can be credited to the pool that actually produced it.
        state.personMeta = state.personMeta || {};
        state.personMeta[pk] = { pool: target.pool, keyword: target.keyword || null };
      }
      saveJson(STATE_PATH, state);
      log(`  ✓ [${fired}/${cap}] (${target.pool}) ${target.name}`);
    } else {
      failures++; consecFail++;
      log(`  ✗ (${target.pool}) ${target.name}: ${res.error}`);
      if (RESTRICTION_RE.test(res.error)) halted = `restriction signal: ${res.error}`;
      else if (consecFail >= 3) halted = `3 consecutive failures (last: ${res.error})`;
      else if (attempts >= 12 && failures / attempts > 0.25) halted = `failure rate ${failures}/${attempts}`;
    }
    // Meter the remaining cap across the day: pace = time left / reactions left,
    // jittered ±40%, floored at throttleMinMs, capped at 15 min. Past the window
    // (late start, catch-up), fall back to the tight random throttle.
    const windowEnd = new Date().setUTCHours(cfg.spreadEndHourUTC, 0, 0, 0);
    const msLeft = windowEnd - Date.now();
    const remaining = Math.max(cap - fired, 1);
    const paced = msLeft > 0
      ? Math.min(Math.max((msLeft / remaining) * (0.6 + Math.random() * 0.8), cfg.throttleMinMs), 15 * 60e3)
      : cfg.throttleMinMs + Math.random() * (cfg.throttleMaxMs - cfg.throttleMinMs);
    await sleep(paced);
    return res?.ok ?? true;
  }

  // ---- fire phase 1: consume the hopper ----
  while (hopper.length && fired < cap && !halted) {
    const t = hopper.shift();
    // re-check at fire time: person may have become 1st-degree or been reacted to since resolution
    if (state.reacted[t.postUrl] || isBlocked(t.linkedinUrl) || onCooldown(t)) continue;
    await fire(t);
    if (!DRY) saveJson(HOPPER_PATH, hopper);
  }

  // ---- fire phase 2 + top-up: live-resolve through pools ----
  // Keeps resolving after the cap is hit to restock the hopper for tomorrow.
  const hopperTarget = NO_TOPUP ? 0 : Math.ceil(nextCap * cfg.hopperMultiplier);
  const pools = [
    { name: "cardio", items: cardioPool() },
    { name: "prosp", items: await prospPool(cfg) },
    { name: "press", items: pressPool() },
    { name: "ksd", items: ksdPool(cap * cfg.ksdFetchMultiplier) },
    { name: "search", items: searchPool(cfg, state) },
  ];
  log(`Pools: ${pools.map((p) => `${p.name} ${p.items.length}`).join(", ")} | hopper target for tomorrow: ${hopperTarget}`);
  const inHopper = new Set(hopper.map((h) => h.postUrl));

  outer:
  for (const pool of pools) {
    for (const t of pool.items) {
      if (halted) break outer;
      if (fired >= cap && hopper.length >= hopperTarget) break outer;
      if (resolveCalls >= cfg.resolveCallBudget) { log(`linkdapi call budget (${cfg.resolveCallBudget}) reached.`); break outer; }
      if (isBlocked(t.linkedinUrl) || onCooldown(t)) continue;
      const postUrl = t.postUrl || resolveLatestPost(t.linkedinUrl, cache, cfg, state);
      if (t.rowid !== undefined && !DRY) saveJson(CURSOR_PATH, { lastRowid: t.rowid, updatedAt: new Date().toISOString() }); // advance over CHECKED rows
      if (resolveCalls % 50 < 2) saveJson(CACHE_PATH, cache);
      if (!postUrl || inHopper.has(postUrl)) continue;
      if (fired < cap) {
        await fire({ ...t, postUrl });
      } else {
        hopper.push({ postUrl, name: t.name, pool: t.pool, linkedinUrl: t.linkedinUrl || "", resolvedAt: Date.now() });
        inHopper.add(postUrl);
        if (!DRY) saveJson(HOPPER_PATH, hopper);
      }
    }
  }

  saveJson(CACHE_PATH, cache);
  if (!DRY) saveJson(HOPPER_PATH, hopper);
  const poolStr = Object.entries(done).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(", ") || "none";
  const summary = `linkedin-reactions day ${days}: ${fired}/${cap} fired (${poolStr}), ${failures} failures, hopper ${hopper.length} stocked for tomorrow (target ${hopperTarget}), ${resolveCalls} linkdapi calls${halted ? ` — HALTED: ${halted}. STOP file created; runs paused until you delete data/reactions-daily.STOP` : ""}`;
  log(summary);

  // ---- ICP gate readout: the daily evidence for which dial to promote next ----
  if (gateStats.scored || gateStats.companyPagesDropped) {
    const pct = gateStats.scored ? Math.round((gateStats.passed / gateStats.scored) * 100) : 0;
    const why = Object.entries(gateStats.reasons).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ") || "none";
    const mode = (cfg.gateBlockOn || []).length ? `BLOCKING on [${cfg.gateBlockOn.join(", ")}] (${gateStats.blocked} skipped)` : "shadow only (nothing blocked)";
    log(`ICP gate: ${gateStats.passed}/${gateStats.scored} would pass (${pct}%) | company pages dropped ${gateStats.companyPagesDropped} | would-reject: ${why} | mode: ${mode}`);
    const csv = ["pool,name,country,followers,industry,verdict,headline"]
      .concat(gateReport.map((r) => [r.pool, r.name, r.country || "?", r.followers, r.industry, r.verdict, (r.headline || "").replace(/\s+/g, " ")]
        .map((f) => `"${String(f).replace(/"/g, '""')}"`).join(",")));
    try { fs.writeFileSync(path.join(ROOT, `data/gate-report-${new Date().toISOString().slice(0, 10)}.csv`), csv.join("\n")); } catch {}
  }

  if (halted && !DRY) fs.writeFileSync(STOP_PATH, `${new Date().toISOString()} ${halted}\n`);
  if (!DRY || halted) whatsapp(summary);
  if (!halted && fired < cap) whatsapp(`linkedin-reactions: under-filled ${fired}/${cap} — hopper + pools + budget exhausted. Consider raising resolveCallBudget or adding pools in data/reactions-daily-config.json`);
})();
