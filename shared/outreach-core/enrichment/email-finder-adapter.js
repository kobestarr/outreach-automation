/**
 * Thin door to Kobi's email finder (kobestarr-tools engines/email-finder). No finding logic lives here:
 * one finder, one memory (~/.kobestarr/email-finder/finder.db). Code is located the same way as the
 * global `email-finder` command (~/.local/bin/email-finder).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const KT_REL = 'Development/One Hour Vibe Coder/kobestarr-tools';
const HEADROOM = 300; // the funded daily batch shares the Reoon key: always leave this many credits

function candidateDirs({ env = process.env, home = os.homedir() } = {}) {
  const kt = path.join(home, KT_REL);
  // Merged code first, the unmerged worktree only as a fallback.
  return [env.EMAIL_FINDER_HOME, path.join(kt, 'engines/email-finder'), path.join(kt, '.worktrees/email-finder/engines/email-finder')].filter(Boolean);
}

function findFinderDir({ env = process.env, home = os.homedir(), exists = fs.existsSync } = {}) {
  const dirs = candidateDirs({ env, home });
  for (const d of dirs) if (exists(path.join(d, 'cli.js')) && exists(path.join(d, 'node_modules'))) return d;
  throw new Error(`email finder code not found. Looked in: ${dirs.join(', ')}. Each needs cli.js and node_modules (run npm install there) or set EMAIL_FINDER_HOME.`);
}

function loadFinderLib({ env = process.env, home = os.homedir(), exists = fs.existsSync, req = require } = {}) {
  return req(path.join(findFinderDir({ env, home, exists }), 'index.js'));
}

/** The finder's own offline estimator (what `email-finder find --dry-run` prints): rows -> { people, companyOnly, badInput, worstCase, samples }. No network, no credits. */
function loadFinderDryRun({ env = process.env, home = os.homedir(), exists = fs.existsSync, req = require } = {}) {
  return req(path.join(findFinderDir({ env, home, exists }), 'src', 'run.js')).dryRun;
}

/** Daily Reoon credits minus headroom, never below zero. */
function defaultMaxCredits(balance, headroom = HEADROOM) {
  const daily = Number(balance && balance.daily);
  return Number.isFinite(daily) ? Math.max(0, Math.floor(daily - headroom)) : 0;
}

/** The library's finder with the Reoon reserve locked off. A missing Icypeas cap means 0, never the library default of 100. */
function openFinder({ maxCredits, maxIcypeas, lib = loadFinderLib() } = {}) {
  const icy = Number.isFinite(maxIcypeas) && maxIcypeas > 0 ? Math.floor(maxIcypeas) : 0;
  return lib.createEmailFinder({ useReserve: false, maxCredits, maxIcypeas: icy });
}

/**
 * The finder for the last-gate checks (suppression, 30-day Reoon memory, balance). Refuses if the memory file does not exist yet:
 * opening would create a fresh empty database, and an empty database has no suppressions.
 */
function openGateFinder({ lib = loadFinderLib(), exists = fs.existsSync } = {}) {
  if (!lib.DEFAULT_DB || !exists(lib.DEFAULT_DB)) {
    throw new Error(`The finder's memory file ${lib.DEFAULT_DB || '(unknown)'} does not exist. A fresh empty one would have no suppressions, so the last gate refuses to run. Restore it or run the finder once.`);
  }
  return openFinder({ maxCredits: 0, maxIcypeas: 0, lib });
}

/** Like openFinder, but when no explicit maxCredits is given the cap is the daily balance minus headroom. */
async function openFinderBounded({ maxCredits, maxIcypeas, headroom = HEADROOM, lib = loadFinderLib() } = {}) {
  let cap = maxCredits;
  if (cap === undefined || cap === null) {
    const probe = openFinder({ maxCredits: 0, maxIcypeas: 0, lib });
    try { cap = defaultMaxCredits(await probe.balance(), headroom); } finally { probe.close(); }
  }
  return openFinder({ maxCredits: cap, maxIcypeas, lib });
}

module.exports = { openGateFinder, findFinderDir, loadFinderDryRun, loadFinderLib, openFinder, openFinderBounded, defaultMaxCredits, candidateDirs, HEADROOM };
