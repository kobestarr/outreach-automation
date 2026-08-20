#!/usr/bin/env node
/**
 * reactions-watchdog.js — hourly guard. Kobi's rule (2026-08-01): reactions must
 * NEVER sit dead. Every hour in the firing window, if the batch is not running and
 * the day is not complete, restart it for the REMAINING portion of today's cap.
 *
 * The ONE exception: a genuine LinkedIn restriction (checkpoint/ban/auth). Auto-
 * restarting into that would get the seat killed, so that case alerts loudly and
 * withholds the restart. A benign "hit linkedapi's daily number" is NOT that: it
 * clears any stale STOP and keeps going. Loop-guard: after 3 restarts with no
 * progress, back off + alert (likely a rolling limit) rather than hammer forever.
 *
 * Cron: 0 8-20 * * * (UTC firing window).
 */
const fs = require("fs"), path = require("path"), os = require("os");
const { execSync, execFileSync, spawn } = require("child_process");
const ROOT = __dirname;
const keys = require(path.join(os.homedir(), ".credentials/api-keys.json"));
const HOPPER = path.join(ROOT, "data/reactions-hopper.json");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const STOP = path.join(ROOT, "data/reactions-daily.STOP");
const today = new Date().toISOString().slice(0, 10);
const LOG = path.join(ROOT, `data/reactions-daily-${today}.log`);
const WSTATE = path.join(ROOT, "data/watchdog-state.json");
const hourUTC = new Date().getUTCHours();
const RESTRICTION_RE = /restrict|challenge|checkpoint|banned|unauthoriz|unauthenticated|invalidToken|accountNotConnected/i;
const log = (m) => console.log(`[watchdog ${new Date().toISOString().slice(11, 19)}] ${m}`);

function whatsapp(message) {
  try {
    const token = fs.readFileSync("/root/.trendmine-internal-token", "utf8").trim();
    execFileSync("curl", ["-s", "-m", "20", "-X", "POST", "-H", `X-Internal-Token: ${token}`, "-H", "Content-Type: application/json", "-d", JSON.stringify({ to: "447989746146", message, source: "reactions-watchdog" }), "http://localhost:3848/send-direct"], { timeout: 30000 });
  } catch (e) { log("whatsapp failed: " + e.message); }
}
// execFileSync (no shell): execSync spawned `sh -c "pgrep -f ..."`, whose own
// command line contains the pattern, so pgrep matched the wrapper shell and
// this ALWAYS returned true — the watchdog never restarted anything and slept
// through the 2026-08-02..05 zero-fired outage. pgrep excludes itself only.
function procAlive() { try { execFileSync("pgrep", ["-f", "daily-reactions-batch.js"], { stdio: "ignore" }); return true; } catch { return false; } }
function relaunch(cap) {
  const args = ["daily-reactions-batch.js"];
  if (cap != null) args.push("--cap", String(cap), "--no-topup");
  const out = fs.openSync(LOG, "a");
  const c = spawn("node", args, { cwd: ROOT, detached: true, stdio: ["ignore", out, out] });
  c.unref();
  log(`relaunched cap ${cap == null ? "full" : cap} pid ${c.pid}`);
}
function loadState() { try { const s = JSON.parse(fs.readFileSync(WSTATE, "utf8")); return s.date === today ? s : { date: today, restarts: 0, lastFired: -1, backedOff: false, alerted: false }; } catch { return { date: today, restarts: 0, lastFired: -1, backedOff: false, alerted: false }; } }
function saveState(s) { try { fs.writeFileSync(WSTATE, JSON.stringify(s)); } catch {} }
// linkdapi credit balance (X-AUTHAPI-Key, trailing slash required — docs 2026-08-05).
function linkdapiBalance() {
  try {
    const out = execFileSync("curl", ["-s", "-m", "25", "-A", UA, "-H", `X-AUTHAPI-Key: ${keys.linkdapi.apiKey}`, "https://linkdapi.com/api/i/v1/credits/balance/k/"], { encoding: "utf8" });
    const j = JSON.parse(out);
    return j?.success && typeof j.data?.balance === "number" ? Math.round(j.data.balance) : null;
  } catch { return null; }
}

(function main() {
  if (hourUTC < 8 || hourUTC >= 20) { log("outside firing window"); return; }
  if (procAlive()) { log("batch running, all good"); return; }

  let txt = ""; try { txt = fs.readFileSync(LOG, "utf8"); } catch {}
  const firedToday = (txt.match(/✓ /g) || []).length;
  const st = loadState();
  if (firedToday > st.lastFired) { st.restarts = 0; st.backedOff = false; } // progress -> reset guard

  // Credit guard: no linkdapi credits + empty hopper means a relaunch cannot
  // possibly fire anything — alert instead of churning (once per day).
  const balance = linkdapiBalance();
  if (balance !== null && balance < 150) {
    let hopperLen = 0; try { hopperLen = (JSON.parse(fs.readFileSync(HOPPER, "utf8")) || []).length; } catch {}
    if (!hopperLen) {
      log(`credits exhausted (balance ${balance}), hopper empty -> alert, no restart`);
      if (!st.creditAlerted) { whatsapp(`reactions watchdog: linkdapi credits EXHAUSTED (balance ${balance}) and hopper is empty — the engine is DEAD until you top up at linkdapi.com. Fired today: ${firedToday}.`); st.creditAlerted = true; }
      saveState(st);
      return;
    }
    log(`credits exhausted (balance ${balance}) but hopper has ${hopperLen} -> continue (hopper-only)`);
  } else if (balance !== null && balance < 5000 && !st.creditWarned) {
    whatsapp(`reactions watchdog: linkdapi credits LOW (balance ${balance}, ~${Math.floor(balance / 400)}d runway at the 400/day cap). Top up at renidly.com.`);
    st.creditWarned = true; saveState(st);
  }

  // Genuine restriction: withhold auto-restart, alert once.
  if (fs.existsSync(STOP)) {
    const reason = fs.readFileSync(STOP, "utf8");
    if (RESTRICTION_RE.test(reason)) {
      log("genuine restriction STOP -> alert, do not restart");
      if (!st.alerted) { whatsapp("reactions: GENUINE LinkedIn restriction detected. Auto-restart withheld to protect the account. Needs you: " + reason.slice(0, 150)); st.alerted = true; saveState(st); }
      return;
    }
    log("benign STOP -> clearing and continuing"); try { fs.unlinkSync(STOP); } catch {}
  }

  const capM = txt.match(/cap (\d+)/);
  const cap = capM ? parseInt(capM[1], 10) : 0;
  if (!cap) { log("no run today -> start full"); relaunch(null); st.restarts++; st.lastFired = 0; saveState(st); whatsapp("reactions watchdog: no run today, started it."); return; }

  const remaining = Math.max(cap - firedToday, 0);
  if (remaining <= 0) { log(`day complete (${firedToday}/${cap})`); saveState(st); return; }

  if (st.restarts >= 3 && firedToday <= st.lastFired) {
    log(`no progress after ${st.restarts} restarts (stuck ${firedToday}/${cap}) -> back off`);
    if (!st.backedOff) { whatsapp(`reactions watchdog: restarted ${st.restarts}x with no progress (stuck ${firedToday}/${cap}), likely a rolling limit. Backing off for today.`); st.backedOff = true; saveState(st); }
    return;
  }

  log(`not running, ${firedToday}/${cap} done -> restart remaining ${remaining}`);
  relaunch(remaining);
  st.restarts++; st.lastFired = firedToday; saveState(st);
})();
