#!/usr/bin/env node
/**
 * daily-profile-views.js — daily LinkedIn profile views via linkedapi.io
 * st.openPersonPage. Runs ALONGSIDE daily-reactions-batch.js and never touches
 * it: stPersonProfileViews and stReactions are separate rate-limit categories.
 *
 * Ramp: 10 +5/day to 80/day. The binding constraint is the WEEKLY 560, not the
 * daily 200, so profile-views-ramp.js enforces a rolling trailing-7-day budget.
 *
 * Renidly/linkdapi is deliberately NOT wired in. st.openPersonPage returns
 * countryCode, followersCount, headline, position, companyName, about and urn
 * for free, so this engine has no reason to spend a credit and is structurally
 * incapable of doing so. See docs/probe-openpersonpage-2026-08-20.md.
 *
 * Every view appends to data/profile-enrichment.jsonl. It must NEVER write to
 * data/reaction-resolve-cache.json: the reactions engine reads that 1.8MB blob
 * whole and writes it whole, so a second writer would silently clobber entries
 * already paid for in credits.
 *
 * NOTE (observed 2026-08-20): linkedapi QUEUES workflows per account. With the
 * reactions engine firing every ~4 minutes, a views workflow can sit in
 * "pending (queued)" for minutes before it starts. Poll budgets here are
 * generous for that reason, and the throttle is computed from the remaining
 * window rather than assumed.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const { execFileSync } = require("child_process");

const CFGMOD = require("./profile-views-config.js");
const RAMP = require("./profile-views-ramp.js");
const TARGET = require("./profile-views-targeting.js");
const LIMITS = require("./linkedapi-limits.js");
const GATE = require("./reaction-icp-gate.js");

const ROOT = __dirname;
const DRY = process.argv.includes("--dry-run");
const P = (f) => path.join(ROOT, "data", f);
const CONFIG_PATH = P("profile-views-config.json");
const STATE_PATH = P("profile-views-state.json");
const STOP_PATH = P("STOP-profile-views");
const ENRICH_PATH = P("profile-enrichment.jsonl");
const VIEWERS_PATH = P("profile-viewers.jsonl");
const LEDGER_PATH = P("credit-ledger.jsonl");
const CACHE_PATH = P("reaction-resolve-cache.json");
const POSTS_PATH = P("posts-seen.jsonl");
const FIRSTDEG_PATH = P("first-degree-connections.txt");
const BLOCKLIST_PATH = P("reactions-blocklist.txt");

const todayISO = () => new Date().toISOString().slice(0, 10);
const LOG_PATH = P(`profile-views-${todayISO()}.log`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function log(msg) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_PATH, line + "\n"); } catch {}
}
function loadJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}
function saveJson(p, o) { fs.writeFileSync(p, JSON.stringify(o, null, 2)); }

const keys = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".credentials/api-keys.json"), "utf8"));
const LA_HEADERS = {
  "linked-api-token": keys.linkedapi_io.apiKey,
  "identification-token": keys.linkedapi_io.identificationToken,
  "Content-Type": "application/json",
};
const ACCOUNT_ID = keys.linkedapi_io.accountId;

// ---------- WhatsApp (same bridge the reactions engine uses) ----------
function whatsapp(message) {
  try {
    const token = fs.readFileSync("/root/.trendmine-internal-token", "utf8").trim();
    execFileSync("curl", ["-s", "-m", "15", "-X", "POST",
      "-H", `X-Internal-Token: ${token}`, "-H", "Content-Type: application/json",
      "-d", JSON.stringify({ to: "447989746146", message, source: "linkedin-profile-views" }),
      "http://localhost:3848/send-direct"], { encoding: "utf8" });
  } catch (e) { log(`whatsapp failed (non-fatal): ${e.message}`); }
}

// ---------- linkedapi.io transport ----------
const TRANSIENT_RE = /EPIPE|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED|ENETUNREACH|socket hang up|timeout/i;
const LIMIT_RE = /limitExceeded|limit for this action|action category has been exceeded/i;
const RESTRICTION_RE = /restrict|challenge|checkpoint|banned|unauthoriz|unauthenticated|invalidToken|accountNotConnected/i;

function laReqOnce(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const r = https.request({ method, hostname: "api.linkedapi.io", path: urlPath, headers: LA_HEADERS, timeout: 30000 }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString() || "{}") }); }
        catch { resolve({ status: res.statusCode, json: {} }); }
      });
    });
    r.on("error", reject);
    r.on("timeout", () => r.destroy(new Error("ETIMEDOUT request timeout")));
    try { if (body) r.write(JSON.stringify(body)); r.end(); } catch (e) { reject(e); }
  });
}
async function laReq(method, urlPath, body, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try { return await laReqOnce(method, urlPath, body); }
    catch (e) {
      const msg = (e && (e.code || e.message)) || "";
      if (!TRANSIENT_RE.test(msg) || i === tries) throw e;
      log(`laReq ${method} ${urlPath} transient (${msg}), retry ${i}/${tries - 1}`);
      await sleep(2000 * i);
    }
  }
}
const laPost = (p, b) => laReq("POST", p, b);

/**
 * POST a workflow and poll it.
 *
 * linkedapi executes ONE workflow at a time per account. Measured 2026-08-20:
 * a queued workflow reported "will start after 6 other pending" while the
 * reactions engine was mid-run. Likes and views have SEPARATE rate-limit
 * budgets but share a SINGLE execution queue, so a views workflow can sit
 * pending for minutes. Hence the generous poll budget, and the queue depth is
 * logged so a backlog is visible rather than looking like a hang.
 */
async function runWorkflow(body, maxPolls = 120) {
  const start = await laReq("POST", "/workflows", body);
  const res0 = (start.json && start.json.result) || {};
  const wfId = res0.workflowId;
  if (!wfId) return { ok: false, error: JSON.stringify(start.json).slice(0, 300) };
  const depth = /after (\d+) other/.exec(res0.message || "");
  if (depth && Number(depth[1]) > 2) log(`  queued behind ${depth[1]} other workflows`);
  for (let i = 0; i < maxPolls; i++) {
    await sleep(6000);
    const p = await laReq("GET", `/workflows/${wfId}`);
    const st = p.json && p.json.result && p.json.result.workflowStatus;
    if (st === "completed") {
      const comp = p.json.result.completion;
      if (comp && comp.success === false) return { ok: false, error: `${comp.error && comp.error.type}: ${comp.error && comp.error.message}` };
      return { ok: true, data: (comp && comp.data) || {} };
    }
    if (st === "failed") return { ok: false, error: JSON.stringify(p.json.result).slice(0, 300) };
  }
  return { ok: false, error: `poll timeout after ${maxPolls * 6}s (queue backlog?)` };
}

const openPersonPage = (personUrl) => runWorkflow({ actionType: "st.openPersonPage", personUrl, basicInfo: true });

/**
 * Do not crowd the reactions engine.
 *
 * PROVEN 2026-08-20, the hard way: ad-hoc probe workflows fired during a live
 * reactions run queued ahead of its reactToPost workflows, pushed three of them
 * past the reactions engine's 180s poll budget, and tripped its
 * 3-consecutive-failure breaker. It halted at 83/190 and wrote a STOP file.
 *
 * linkedapi runs ONE workflow at a time per account. The reactions engine polls
 * for only 180s and CANNOT be changed from here, so the whole obligation sits on
 * this engine. Two cheap rules, neither of which costs an API call:
 *
 *   1. Never hold more than one workflow in flight. This engine is strictly
 *      sequential, so the only way to breach that is to run two copies, which
 *      the pgrep guard already prevents.
 *   2. When the reactions engine is mid-run, space views out further so a view
 *      never lands between a like being queued and that like being polled.
 *
 * Views are not time-critical. Likes are already in flight. Views yield.
 */
function reactionsEngineRunning() {
  try {
    const out = execFileSync("pgrep", ["-f", "daily-reactions-batch.js"], { encoding: "utf8" });
    return out.split("\n").map((x) => x.trim()).filter(Boolean).length > 0;
  } catch {
    return false; // pgrep exits 1 when nothing matches
  }
}

// ---------- source loading (all local, zero discovery cost) ----------
const usernameOf = (url) => {
  const m = (url || "").match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (!m) return null;
  try { return decodeURIComponent(m[1]).toLowerCase(); } catch { return m[1].toLowerCase(); }
};
// Cache keys arrive both decoded (emoji usernames) and percent-encoded, so
// normalise before building a URL or we emit a raw-unicode or double-encoded path.
const profileUrlFor = (u) => {
  let decoded = u;
  try { decoded = decodeURIComponent(u); } catch { /* already decoded */ }
  return `https://www.linkedin.com/in/${encodeURIComponent(decoded)}`;
};
function readLines(p) {
  try {
    return fs.readFileSync(p, "utf8").split("\n").map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  } catch { return []; }
}
/** authorUsername -> most recent postedAt (epoch ms) */
function lastPostedByAuthor() {
  const out = new Map();
  let raw;
  try { raw = fs.readFileSync(POSTS_PATH, "utf8"); } catch { return out; }
  for (const line of raw.split("\n")) {
    if (!line) continue;
    let d; try { d = JSON.parse(line); } catch { continue; }
    const u = usernameOf(d.authorUrl);
    if (!u) continue;
    const t = d.postedAt || 0;
    if (t > (out.get(u) || 0)) out.set(u, t);
  }
  return out;
}
function csvUsernames(file) {
  const out = [];
  let raw;
  try { raw = fs.readFileSync(P(file), "utf8"); } catch { return out; }
  const lines = raw.split("\n").filter(Boolean);
  if (!lines.length) return out;
  const head = lines[0].split(",").map((h) => h.replace(/"/g, "").trim().toLowerCase());
  const col = head.findIndex((h) => h.includes("linkedin"));
  if (col < 0) return out;
  for (const line of lines.slice(1)) {
    const cells = line.match(/("([^"]|"")*"|[^,]*)/g) || [];
    const u = usernameOf((cells[col] || "").replace(/^"|"$/g, ""));
    if (u) out.push(u);
  }
  return out;
}

function buildCandidates(cache, posted) {
  const seen = new Set();
  const out = [];
  const add = (u, pool) => {
    if (!u || seen.has(u)) return;
    seen.add(u);
    out.push({
      username: u,
      linkedinUrl: profileUrlFor(u),
      pool,
      lastPostedAt: posted.get(u) || null,
    });
  };
  // Post authors first so they claim the views-active label.
  for (const u of posted.keys()) add(u, "views-active");
  for (const u of Object.keys(cache)) add(u, "views-cache");
  for (const [file, pool] of [["pool-ksd.csv", "views-ksd"], ["pool-campaign.csv", "views-campaign"], ["pool-press.csv", "views-press"]]) {
    for (const u of csvUsernames(file)) add(u, pool);
  }
  return out;
}

// ---------- guards ----------
function singleInstanceGuard() {
  // NOTE: filters own pid and ppid only. A `timeout` wrapper makes the shell a
  // GRANDparent, which false-positives. Do not wrap the cron in `timeout`.
  try {
    const out = execFileSync("pgrep", ["-f", "daily-profile-views.js"], { encoding: "utf8" });
    const pids = out.split("\n").map((s) => s.trim()).filter(Boolean)
      .filter((p) => p !== String(process.pid) && p !== String(process.ppid));
    if (pids.length) { log(`another instance is running (pids ${pids.join(",")}), exiting`); process.exit(0); }
  } catch { /* pgrep exits 1 when nothing matches */ }
}
process.on("unhandledRejection", (e) => {
  log(`unhandledRejection: ${e && e.message}`);
  whatsapp(`profile-views: unhandledRejection ${e && e.message}`);
  process.exit(1);
});
process.on("uncaughtException", (e) => {
  log(`uncaughtException: ${e && e.message}`);
  whatsapp(`profile-views: uncaughtException ${e && e.message}`);
  process.exit(1);
});

// ---------- main ----------
async function main() {
  singleInstanceGuard();
  if (fs.existsSync(STOP_PATH)) { log("STOP file present, exiting"); return; }

  const cfg = CFGMOD.loadConfig(loadJson, CONFIG_PATH);
  const state = loadJson(STATE_PATH, { viewed: {}, history: {}, observedLimit: null, rampFrozen: false });
  if (!state.viewed) state.viewed = {};
  if (!state.history) state.history = {};

  // First run sets the ramp start date, in BOTH the state and the JSON config.
  const today = todayISO();
  if (!cfg.rampStartDate) {
    cfg.rampStartDate = today;
    const raw = loadJson(CONFIG_PATH, {});
    raw.rampStartDate = today;
    saveJson(CONFIG_PATH, raw);
    log(`ramp start date initialised to ${today}`);
  }

  const cap = RAMP.effectiveCap(cfg, state, today);
  const daily = RAMP.dailyCap(cfg, state, today);
  const weekLeft = RAMP.weeklyRemaining(cfg, state, today);
  log(`Daily profile views | day ${RAMP.rampDay(cfg, today)} | daily cap ${daily} | week left ${weekLeft} | firing ${cap}${DRY ? " | DRY-RUN" : ""}`);
  if (state.rampFrozen) log(`ramp FROZEN at observedLimit ${state.observedLimit}, holding at ${daily}`);

  // Who viewed us back. Runs even on a zero-fire day: it is the measurement.
  if (!DRY) {
    const since = state.lastViewerSweep || new Date(Date.now() - 7 * 864e5).toISOString();
    await trackProfileViewers(since);
    state.lastViewerSweep = new Date().toISOString();
    saveJson(STATE_PATH, state);
  }

  if (cap === 0) { log("nothing to fire today (weekly budget spent), exiting cleanly"); return; }

  // Live quota check before we spend anything.
  const usage0 = await LIMITS.getUsage(laPost, ACCOUNT_ID, "stPersonProfileViews");
  if (usage0.daily) log(`linkedapi usage: daily ${usage0.daily.used}/${usage0.daily.max}, weekly ${usage0.weekly ? usage0.weekly.used + "/" + usage0.weekly.max : "?"}`);
  const stop0 = LIMITS.shouldStop(usage0);
  if (stop0.stop) { log(`linkedapi says ${stop0.reason}, exiting cleanly`); return; }
  // Never plan to fire more than linkedapi will actually allow.
  const headroom = LIMITS.remaining(usage0);
  const todayCap = Math.min(cap, headroom === Infinity ? cap : headroom);
  if (todayCap < cap) log(`trimmed to ${todayCap} by live linkedapi headroom`);

  const cache = loadJson(CACHE_PATH, {});
  const posted = lastPostedByAuthor();
  const firstDegree = new Set(readLines(FIRSTDEG_PATH));
  const blocklist = new Set(readLines(BLOCKLIST_PATH).map((l) => usernameOf(l) || l.toLowerCase()));
  log(`Sources: cache ${Object.keys(cache).length}, post authors ${posted.size}, 1st-degree ${firstDegree.size}, blocklist ${blocklist.size}`);
  // A missing or empty first-degree file silently removes a whole exclusion
  // class, so we would spend the day viewing people we are already connected to.
  if (firstDegree.size < 100) {
    log(`WARNING: only ${firstDegree.size} 1st-degree connections loaded from ${FIRSTDEG_PATH}. Expected thousands. Existing connections will NOT be excluded.`);
    if (!DRY) whatsapp(`profile-views: 1st-degree list looks wrong (${firstDegree.size} entries). Connections are not being excluded.`);
  }
  if (posted.size === 0) log(`NOTE: no post history loaded from ${POSTS_PATH}, so nothing is ranked by recency.`);

  const ctx = { cfg, state, firstDegree, blocklist, cache, gate: GATE, nowMs: Date.now() };
  const queue = TARGET.buildQueue(buildCandidates(cache, posted), ctx);
  const byPool = queue.slice(0, todayCap).reduce((a, t) => { a[t.pool] = (a[t.pool] || 0) + 1; return a; }, {});
  log(`Queue: ${queue.length} eligible | today's slice by pool: ${JSON.stringify(byPool)}`);
  if (!queue.length) { log("queue empty, exiting cleanly"); return; }

  let fired = 0, consecFail = 0, halted = null;
  const windowEnd = new Date(); windowEnd.setUTCHours(cfg.spreadEndHourUTC, 0, 0, 0);

  for (const target of queue) {
    if (fired >= todayCap) break;
    if (fs.existsSync(STOP_PATH)) { halted = "STOP file appeared mid-run"; break; }

    if (DRY) {
      log(`  [would VIEW] (${target.pool}) ${target.username} score ${target.score}`);
      fired++;
      continue;
    }

    const res = await openPersonPage(target.linkedinUrl);

    if (res.ok) {
      fired++; consecFail = 0;
      state.viewed[target.username] = new Date().toISOString();
      RAMP.recordFires(state, today, 1);
      const d = res.data || {};
      // Append-only. NEVER write reaction-resolve-cache.json from here.
      try {
        fs.appendFileSync(ENRICH_PATH, JSON.stringify({
          ts: new Date().toISOString(), username: target.username, pool: target.pool,
          urn: d.urn || null, countryCode: d.countryCode || null, followers: d.followersCount || 0,
          headline: d.headline || "", position: d.position || "", companyName: d.companyName || "",
          about: d.about || "", source: "st.openPersonPage",
        }) + "\n");
      } catch (e) { log(`enrichment append failed (non-fatal): ${e.message}`); }
      saveJson(STATE_PATH, state);
      log(`  ✓ [${fired}/${todayCap}] (${target.pool}) ${d.name || target.username} ${d.countryCode || "?"} ${d.followersCount || 0}f`);
    } else {
      const err = String(res.error || "");
      if (LIMIT_RE.test(err)) {
        // linkedapi's own configured limit. Benign. End the day CLEANLY and
        // NEVER write a STOP file: that would block tomorrow and the watchdog.
        RAMP.recordLimitHit(state, fired);
        saveJson(STATE_PATH, state);
        log(`limitExceeded at ${fired} views. Ramp frozen, holding at ${Math.floor(fired * 0.9)}. Ending the day cleanly.`);
        whatsapp(`profile-views: limitExceeded at ${fired} views. Ramp frozen. This is the number we were ramping to find.`);
        halted = "limitExceeded";
        break;
      }
      if (RESTRICTION_RE.test(err)) {
        // A genuine LinkedIn restriction. Auto-restarting into this kills the seat.
        fs.writeFileSync(STOP_PATH, `restriction ${new Date().toISOString()}: ${err}\n`);
        log(`RESTRICTION: ${err}. STOP file written.`);
        whatsapp(`profile-views: LinkedIn RESTRICTION, engine stopped. ${err.slice(0, 200)}`);
        halted = "restriction";
        break;
      }
      consecFail++;
      log(`  ✗ (${target.pool}) ${target.username}: ${err.slice(0, 160)}`);
      if (consecFail >= cfg.maxConsecutiveFailures) {
        halted = `${consecFail} consecutive failures`;
        whatsapp(`profile-views: halted after ${consecFail} consecutive failures. Last: ${err.slice(0, 200)}`);
        break;
      }
    }

    // Re-read the live quota periodically: other tools share this budget.
    if (fired > 0 && fired % cfg.usagePollEvery === 0) {
      const u = await LIMITS.getUsage(laPost, ACCOUNT_ID, "stPersonProfileViews");
      const s = LIMITS.shouldStop(u);
      if (s.stop) { log(`linkedapi says ${s.reason}, ending the day cleanly`); halted = s.reason; break; }
    }

    // Spread the remainder across the rest of the window rather than a fixed
    // gap: a fixed range does not fit (80 views over 08:15-20:00 is 529s with
    // zero slack), so any stall would silently truncate the day.
    const remaining = todayCap - fired;
    if (remaining > 0) {
      const msLeft = windowEnd.getTime() - Date.now();
      const spread = msLeft > 0 ? msLeft / remaining : cfg.throttleMinMs;
      // While reactions is mid-run we share its execution queue, so widen the
      // gap. A like that waits behind a view for more than 180s is a failure
      // for the reactions engine, and three of those halt it.
      const busy = reactionsEngineRunning() ? cfg.yieldToReactionsFactor : 1;
      const delay = Math.min(cfg.throttleMaxMs, Math.max(cfg.throttleMinMs * busy, spread * busy));
      await sleep(Math.round(delay * (0.85 + Math.random() * 0.3)));
    }
  }

  saveJson(STATE_PATH, state);
  log(`Done. Fired ${fired}/${todayCap}${halted ? ` | halted: ${halted}` : ""} | week now ${RAMP.weeklyRemaining(cfg, state, today)} left`);

  // Renidly reconciliation: this engine makes no billable calls, so a
  // workstream:"views" row in the ledger is an ALARM, not noise.
  try {
    const rows = fs.readFileSync(LEDGER_PATH, "utf8").split("\n")
      .filter((l) => l.includes('"workstream":"views"'));
    if (rows.length) {
      log(`ALARM: ${rows.length} views rows in credit-ledger.jsonl. This engine must not bill.`);
      whatsapp(`profile-views: ALARM, ${rows.length} Renidly ledger rows tagged views. This engine should cost zero.`);
    }
  } catch { /* no ledger yet is the expected state */ }
}

if (require.main === module) main();
module.exports = { buildCandidates, usernameOf, profileUrlFor, lastPostedByAuthor, csvUsernames, reactionsEngineRunning };
