// hiring-signals/build-digest.js
//
// Stage 5 of the Signal Engine (docs/hiring-signals-architecture.md): assigns a REACH/LOOK/DROP
// verdict to every SignalRecord, splits records into action buckets, and renders a plain-text +
// markdown digest grouped by lane then brand.
//
// Pure functions, no I/O, safe to unit test directly. The CLI at the bottom is the only
// side-effecting bit (reads a JSON file, prints to stdout).
//
// Contract notes (see report for the full list):
//  - assignVerdict() follows the accreting-merge pattern used across the pipeline (classify()
//    in decision-maker-resolver.js): it returns a NEW object (record + verdict + why), it never
//    mutates its input.
//  - "hasContact" = a non-empty email OR a confirmed LinkedIn (linkedinResolved === true), per
//    the architecture doc's "has contact (email or confirmed LinkedIn)" REACH rule.
//  - "hot" = gateConfidence AND dmConfidence both >= 0.6 (the same bar REACH uses, minus contact).
//  - DROP's "below 0.4" is applied to EITHER confidence metric (gate or dm). A strong gate read
//    paired with a wrong-person resolver guess is still a bad lead, and vice versa.
//  - REACH additionally requires a resolved dmName. A record can carry a high dmConfidence number
//    yet no dmName (contradictory upstream state, or "confident this pattern-guessed email is
//    safe but we never actually named a person"). You can't pitch a person you haven't named, so
//    that case is LOOK, not REACH. This is what makes the doc's "dmName null-but-not-dropped ->
//    LOOK" rule reachable instead of dead code.
//  - lane in {website-pitch, review} is an override checked BEFORE the REACH test: a company with
//    no domain (website-pitch) or one the gate flagged for a human look (review) should never
//    auto-REACH just because a contact happened to resolve. The intended action for that lane is
//    the pitch/human-review workflow, not a cold-email send.
//  - splitBuckets()'s four action buckets (emailLead/prospConnect/manualFind/websitePitch) are NOT
//    a strict partition of the full record set, they're the specific actionable subsets the
//    architecture doc names. `dropped` IS exhaustive (every verdict==='DROP' record lands there).
//    renderDigest() is the exhaustive audit view: every record appears in exactly one table row.

const fs = require('fs');

// ---------- verdict thresholds ----------
const HOT_THRESHOLD = 0.6;
const LOW_THRESHOLD = 0.4;

function num(x) { return typeof x === 'number' ? x : 0; }
function hasContact(record) { return !!(record.email) || record.linkedinResolved === true; }
function isHot(record) { return num(record.gateConfidence) >= HOT_THRESHOLD && num(record.dmConfidence) >= HOT_THRESHOLD; }
function hasSafeEmail(record) {
  return !!record.email && (record.reoonStatus === 'safe' || record.emailSource === 'website');
}

// assignVerdict(record) -> record's fields + { verdict, why } (accreting merge, non-mutating).
function assignVerdict(record) {
  const gate = num(record.gateConfidence);
  const dm = num(record.dmConfidence);
  const contact = hasContact(record);

  let verdict, why;

  if (record.dropReason) {
    verdict = 'DROP';
    why = `dropped: ${record.dropReason}`;
  } else if (gate < LOW_THRESHOLD || dm < LOW_THRESHOLD) {
    verdict = 'DROP';
    why = `confidence below ${LOW_THRESHOLD} (gate ${gate}, dm ${dm})`;
  } else if (record.lane === 'website-pitch' || record.lane === 'review') {
    // override, checked before REACH so a resolved contact never bypasses the pitch/review workflow
    verdict = 'LOOK';
    why = `lane=${record.lane}`;
  } else if (contact && gate >= HOT_THRESHOLD && dm >= HOT_THRESHOLD && record.dmName) {
    verdict = 'REACH';
    why = 'contact resolved to a named decision-maker, gate and dm confidence both high';
  } else if (!contact && isHot(record)) {
    verdict = 'LOOK';
    why = 'hot lead (high gate and dm confidence) but no contact resolved yet';
  } else if ((gate >= LOW_THRESHOLD && gate < HOT_THRESHOLD) || (dm >= LOW_THRESHOLD && dm < HOT_THRESHOLD)) {
    verdict = 'LOOK';
    why = `mid-confidence (gate ${gate}, dm ${dm}) needs a human look`;
  } else if (!record.dmName) {
    verdict = 'LOOK';
    why = 'no decision-maker name resolved';
  } else {
    // safety net: never silently drop a record the branches above didn't catch
    verdict = 'LOOK';
    why = 'unclassified, defaulting to manual look';
  }

  return { ...record, verdict, why };
}

function withVerdicts(records) {
  return (records || []).map(r => (r.verdict ? r : assignVerdict(r)));
}

// ---------- bucket split ----------
function splitBuckets(records) {
  const withV = withVerdicts(records);
  const buckets = { emailLead: [], prospConnect: [], manualFind: [], websitePitch: [], dropped: [] };

  for (const r of withV) {
    if (r.verdict === 'DROP') buckets.dropped.push(r);
    if (r.lane === 'small-direct' && r.verdict === 'REACH' && hasSafeEmail(r)) buckets.emailLead.push(r);
    if (r.lane === 'mid-augmentation' && r.linkedinResolved === true) buckets.prospConnect.push(r);
    if (isHot(r) && !hasContact(r)) buckets.manualFind.push(r);
    if (r.lane === 'website-pitch') buckets.websitePitch.push(r);
  }
  return buckets;
}

// ---------- render ----------
const LANE_ORDER = ['small-direct', 'mid-augmentation', 'website-pitch', 'review', 'drop'];
const BRAND_ORDER = ['kobestarr', 'stripped', 'dealflow'];
const BLANK = '-'; // table placeholder for null/empty cells

function laneRank(lane) {
  const i = LANE_ORDER.indexOf(lane);
  return i === -1 ? LANE_ORDER.length : i;
}
function brandRank(brand) {
  const i = BRAND_ORDER.indexOf(brand);
  return i === -1 ? BRAND_ORDER.length : i;
}
function laneLabel(lane) { return lane === null || lane === undefined ? 'no-lane' : lane; }

function esc(v) {
  if (v === null || v === undefined || v === '') return BLANK;
  const s = String(v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
  return s || BLANK;
}
function dmCell(r) {
  if (!r.dmName) return BLANK;
  return r.dmTitle ? `${r.dmName} (${r.dmTitle})` : r.dmName;
}

function countBy(records, keyFn) {
  const counts = {};
  for (const r of records) {
    const k = keyFn(r);
    counts[k] = (counts[k] || 0) + 1;
  }
  return counts;
}
function formatCounts(counts) {
  const keys = Object.keys(counts);
  if (!keys.length) return 'none';
  return keys.map(k => `${k} ${counts[k]}`).join(', ');
}

// renderDigest(records) -> plain-text + markdown-table digest string.
function renderDigest(records) {
  const withV = withVerdicts(records);
  const lines = [];

  lines.push('# Hiring Signal Digest');
  lines.push('');
  lines.push('## Summary');
  lines.push(`Total records: ${withV.length}`);
  lines.push(`By verdict: ${formatCounts(countBy(withV, r => r.verdict))}`);
  lines.push(`By lane: ${formatCounts(countBy(withV, r => laneLabel(r.lane)))}`);
  lines.push('');

  if (!withV.length) {
    lines.push('No records.');
    return lines.join('\n');
  }

  // group by lane, then brand
  const byLane = new Map();
  for (const r of withV) {
    const lane = laneLabel(r.lane);
    if (!byLane.has(lane)) byLane.set(lane, []);
    byLane.get(lane).push(r);
  }
  const lanes = [...byLane.keys()].sort((a, b) => laneRank(a) - laneRank(b));

  for (const lane of lanes) {
    const laneRecords = byLane.get(lane);
    lines.push(`## Lane: ${lane} (${laneRecords.length})`);

    const byBrand = new Map();
    for (const r of laneRecords) {
      const brand = r.brand || 'unknown';
      if (!byBrand.has(brand)) byBrand.set(brand, []);
      byBrand.get(brand).push(r);
    }
    const brands = [...byBrand.keys()].sort((a, b) => brandRank(a) - brandRank(b));

    for (const brand of brands) {
      const brandRecords = byBrand.get(brand);
      lines.push('');
      lines.push(`### Brand: ${brand} (${brandRecords.length})`);
      lines.push('| Company | One-liner | Size | Brand | Role | DM | LinkedIn | Email | Verdict |');
      lines.push('|---|---|---|---|---|---|---|---|---|');
      for (const r of brandRecords) {
        lines.push('| ' + [
          esc(r.companyName), esc(r.companyOneLiner), esc(r.sizeBand), esc(r.brand),
          esc(r.roleTitle), dmCell(r), esc(r.dmLinkedIn), esc(r.email), esc(r.verdict),
        ].join(' | ') + ' |');
      }
    }
    lines.push('');
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

module.exports = {
  assignVerdict,
  withVerdicts,
  splitBuckets,
  renderDigest,
  hasContact,
  isHot,
  hasSafeEmail,
  HOT_THRESHOLD,
  LOW_THRESHOLD,
};

// ---- CLI ----
// Usage: node hiring-signals/build-digest.js <records.json>
if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node hiring-signals/build-digest.js <records.json>');
    process.exit(2);
  }
  let records;
  try {
    records = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`FATAL: could not read/parse ${file}: ${e.message}`);
    process.exit(1);
  }
  console.log(renderDigest(records));
}
