#!/usr/bin/env node
/**
 * reaction-attribution-run.js — closes the loop on the reactions engine.
 *
 * Matches inbound LinkedIn invitations against the people the daily batch
 * liked, so we learn which POOL converts likes into invites. That number, not
 * the raw like count, is what should decide the mix as the ramp climbs to 400+.
 *
 * WHY IT IS A SEPARATE CRON, NOT PART OF THE BATCH (learned the hard way
 * 2026-07-22): st.retrieveInvitations was measured still running after 35 min
 * against an advertised 2-4. linkedapi executes ONE workflow at a time per
 * account, so a slow retrieval anywhere near the firing window leaves every
 * queued like stuck behind it, each poll timing out into the batch's
 * 3-consecutive-failure halt. That is the 2026-07-21 outage. So:
 *   - runs at 21:30 UTC, after the 20:00 spread window has closed
 *   - CANCELS its own workflow (undocumented DELETE /workflows/{id}, verified
 *     working) if it blows the poll budget, so nothing is ever left queued
 *
 * Usage: node reaction-attribution-run.js [--dry-run]
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const { execFileSync } = require("child_process");

const ROOT = __dirname;
const ATTR = require("./reaction-attribution.js");
const keys = require(path.join(os.homedir(), ".credentials/api-keys.json"));
const CONFIG_PATH = path.join(ROOT, "data/reactions-daily-config.json");
const STATE_PATH = path.join(ROOT, "data/linkedin-reacted-state.json");
const ATTR_PATH = path.join(ROOT, "data/reaction-attribution.json");

const DRY = process.argv.includes("--dry-run");
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const loadJson = (p, f) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return f; } };
const saveJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2));

const ON_VPS = fs.existsSync("/root/.trendmine-internal-token");
function whatsapp(message) {
  if (DRY) { log(`[dry] WhatsApp: ${message}`); return; }
  const payload = JSON.stringify({ to: "447989746146", message, source: "linkedin-reactions-attribution" });
  try {
    if (ON_VPS) {
      const token = fs.readFileSync("/root/.trendmine-internal-token", "utf8").trim();
      execFileSync("curl", ["-s", "-m", "20", "-X", "POST", "-H", `X-Internal-Token: ${token}`, "-H", "Content-Type: application/json", "-d", payload, "http://localhost:3848/send-direct"], { timeout: 30000 });
    } else {
      execFileSync("ssh", ["clawdbot", `TOKEN=$(cat /root/.trendmine-internal-token); curl -s -m 20 -X POST -H "X-Internal-Token: $TOKEN" -H "Content-Type: application/json" -d ${JSON.stringify(payload)} http://localhost:3848/send-direct`], { timeout: 30000 });
    }
  } catch (e) { log(`WhatsApp notify failed (non-fatal): ${e.message}`); }
}

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

/**
 * Start a workflow, poll it, and CANCEL it if the budget runs out — never leave
 * one queued, or the next morning's likes starve behind it.
 * @returns {Promise<Array|null>} completion data, or null on failure/timeout
 */
async function runWorkflow(actionType, minutes, options = {}) {
  const start = await laReq("POST", "/workflows", { actionType, ...options });
  const wfId = start.json?.result?.workflowId;
  if (!wfId) { log(`${actionType}: could not start: ${JSON.stringify(start.json).slice(0, 180)}`); return null; }
  for (let i = 0; i < Math.ceil((minutes * 60) / 10); i++) {
    await sleep(10000);
    const p = await laReq("GET", `/workflows/${wfId}`);
    const st = p.json?.result?.workflowStatus;
    if (st === "completed") return p.json.result.completion?.data || [];
    if (st === "failed") { log(`${actionType}: failed: ${JSON.stringify(p.json.result).slice(0, 180)}`); return null; }
  }
  const c = await laReq("DELETE", `/workflows/${wfId}`);
  log(`${actionType}: ${minutes}min budget exhausted — cancelled: ${JSON.stringify(c.json?.result || {})}`);
  return null;
}

(async () => {
  const cfg = Object.assign({ attributionWindowDays: 21, attributionPollMinutes: 25 }, loadJson(CONFIG_PATH, {}));
  const state = loadJson(STATE_PATH, { reacted: {}, persons: {}, personMeta: {} });
  const opts = { windowDays: cfg.attributionWindowDays, meta: state.personMeta || {} };
  log(`Attribution run | ${Object.keys(state.persons || {}).length} people liked on record | window ${cfg.attributionWindowDays}d${DRY ? " | DRY-RUN" : ""}`);

  let credited = [], byPool = {};
  const tally = (res) => {
    credited = credited.concat(res.attributed);
    for (const [k, v] of Object.entries(res.byPool)) byPool[k] = (byPool[k] || 0) + v;
  };

  // ---- 1. PENDING invites: caught before Kobi accepts ----
  const invites = await runWorkflow("st.retrieveInvitations", cfg.attributionPollMinutes);
  if (invites) {
    const res = ATTR.attribute(invites, state.persons || {}, opts);
    tally(res);
    log(`Invites: ${invites.length} pending | ${res.attributed.length} credited to our likes | ${res.unattributed.length} from elsewhere`);
  }

  // ---- 2. ACCEPTED connections via `since` (the ones invites can never see) ----
  // A pending invite disappears the moment it is accepted (Armando Zuccali was
  // already 1st-degree when we first polled, so invites alone scored zero).
  // st.retrieveConnections with NO `since` pulls the entire network and timed out
  // every night — the 25min-budget self-cancel fired on Kobi's 3,000+ list, so
  // this half never actually ran. `since` returns ONLY connections made in-window
  // (with connectedAt), so it completes fast and is reliable. No snapshot diff.
  if (cfg.attributionConnectionsDiff !== false) {
    const since = new Date(Date.now() - cfg.attributionWindowDays * 86400000).toISOString();
    const conns = await runWorkflow("st.retrieveConnections", cfg.attributionPollMinutes, { since });
    if (conns) {
      const res = ATTR.attribute(conns, state.persons || {}, Object.assign({ source: "connection" }, opts));
      tally(res);
      log(`Connections: ${conns.length} made since ${since.slice(0, 10)} | ${res.attributed.length} credited to our likes`);
    }
  }

  const ledger = ATTR.mergeLedger(loadJson(ATTR_PATH, []), credited);
  if (!DRY) saveJson(ATTR_PATH, ledger);

  const poolStr = Object.entries(byPool).map(([k, v]) => `${k} ${v}`).join(", ") || "none";
  log(`TOTAL credited to reactions: ${credited.length} (${poolStr}) | ledger ${ledger.length} all-time | ${ATTR.pendingProspPush(ledger).length} awaiting Prosp push`);
  for (const a of credited) log(`  ↩ ${a.name} (${a.pool}${a.keyword ? `: ${a.keyword}` : ""}) via ${a.source} — ${a.daysToConnect}d after the like — ${a.linkedinUrl}`);

  if (credited.length) {
    const names = credited.slice(0, 5).map((a) => `${a.name} (${a.pool})`).join(", ");
    whatsapp(`linkedin-reactions: ${credited.length} new connection(s)/invite(s) traced back to our likes — ${names}. Pools: ${poolStr}.`);
  }
})();
