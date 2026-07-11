// tests/build-digest.test.js
const assert = require('assert');
const D = require('../hiring-signals/build-digest.js');

let passed = 0;
const test = (name, fn) => Promise.resolve().then(fn).then(() => { passed++; console.log('  ok -', name); })
  .catch(e => { console.error('  FAIL -', name, '\n   ', e.message); process.exitCode = 1; });

// Minimal-but-complete SignalRecord stub; override per test.
function rec(overrides = {}) {
  return {
    jobId: 'J1', jobUrl: 'https://x.test/J1', brand: 'kobestarr', term: 'SEO manager',
    roleTitle: 'SEO Manager', companyName: 'Acme Ltd', location: 'Manchester, UK',
    workplaceType: 'Hybrid', salary: null, easyApply: true, isPromoted: false,
    jobDescription: null, posterEmail: null, posterName: null,
    companyDomain: 'acme.com', companyOneLiner: 'A widget maker.', businessType: 'business',
    sizeBand: 'small', estimatedHeadcount: 8, isRealEmployer: true, lane: 'small-direct',
    dropReason: null, gateConfidence: 0.8,
    dmName: 'Jane Doe', dmTitle: 'Founder', dmLinkedIn: null, dmConfidence: 0.8, dmSources: ['companiesHouse'], segment: 'small-founder',
    email: null, reoonStatus: null, emailSource: null, contactConfidence: 0, linkedinResolved: false,
    verdict: null, why: null,
    ...overrides,
  };
}

(async () => {
  // ================= assignVerdict: threshold branches =================
  await test('REACH: safe email + named DM + gate/dm >= 0.6', () => {
    const r = D.assignVerdict(rec({ email: 'jane@acme.com', reoonStatus: 'safe', gateConfidence: 0.9, dmConfidence: 0.9 }));
    assert.strictEqual(r.verdict, 'REACH');
    assert.ok(r.why);
  });
  await test('REACH: confirmed LinkedIn (no email) + named DM + gate/dm >= 0.6', () => {
    const r = D.assignVerdict(rec({ email: null, linkedinResolved: true, dmLinkedIn: 'https://linkedin.com/in/jane', gateConfidence: 0.7, dmConfidence: 0.7 }));
    assert.strictEqual(r.verdict, 'REACH');
  });
  await test('DROP: dropReason set, regardless of confidence', () => {
    const r = D.assignVerdict(rec({ dropReason: 'recruiter agency', gateConfidence: 0.95, dmConfidence: 0.95 }));
    assert.strictEqual(r.verdict, 'DROP');
    assert.match(r.why, /recruiter agency/);
  });
  await test('DROP: gateConfidence below 0.4', () => {
    const r = D.assignVerdict(rec({ gateConfidence: 0.3, dmConfidence: 0.9, email: 'jane@acme.com' }));
    assert.strictEqual(r.verdict, 'DROP');
  });
  await test('DROP: dmConfidence below 0.4', () => {
    const r = D.assignVerdict(rec({ gateConfidence: 0.9, dmConfidence: 0.1, email: 'jane@acme.com' }));
    assert.strictEqual(r.verdict, 'DROP');
  });
  await test('DROP takes priority over dropReason-less low confidence AND lane checks', () => {
    const r = D.assignVerdict(rec({ lane: 'review', gateConfidence: 0.2, dmConfidence: 0.9 }));
    assert.strictEqual(r.verdict, 'DROP');
  });
  await test('LOOK: hot (gate+dm >= 0.6) but missing contact', () => {
    const r = D.assignVerdict(rec({ email: null, linkedinResolved: false, gateConfidence: 0.7, dmConfidence: 0.7 }));
    assert.strictEqual(r.verdict, 'LOOK');
    assert.match(r.why, /hot/i);
  });
  await test('LOOK: mid-confidence band 0.4-0.6 on gate', () => {
    const r = D.assignVerdict(rec({ email: 'jane@acme.com', gateConfidence: 0.5, dmConfidence: 0.9 }));
    assert.strictEqual(r.verdict, 'LOOK');
  });
  await test('LOOK: mid-confidence band 0.4-0.6 on dm', () => {
    const r = D.assignVerdict(rec({ email: 'jane@acme.com', gateConfidence: 0.9, dmConfidence: 0.5 }));
    assert.strictEqual(r.verdict, 'LOOK');
  });
  await test('LOOK: lane=website-pitch overrides an otherwise-REACH record', () => {
    const r = D.assignVerdict(rec({ lane: 'website-pitch', email: 'jane@acme.com', gateConfidence: 0.9, dmConfidence: 0.9 }));
    assert.strictEqual(r.verdict, 'LOOK');
    assert.match(r.why, /website-pitch/);
  });
  await test('LOOK: lane=review overrides an otherwise-REACH record', () => {
    const r = D.assignVerdict(rec({ lane: 'review', email: 'jane@acme.com', gateConfidence: 0.9, dmConfidence: 0.9 }));
    assert.strictEqual(r.verdict, 'LOOK');
    assert.match(r.why, /review/);
  });
  await test('LOOK: dmName null but not dropped, even with contact + high confidence', () => {
    // Contact present, gate/dm both hot, lane is a normal outreach lane: everything lines up for
    // REACH EXCEPT there is no named decision-maker. REACH requires a dmName, so this must fall
    // through to the dedicated "no decision-maker name resolved" branch, not silently REACH.
    const r = D.assignVerdict(rec({ dmName: null, email: 'contact@acme.com', gateConfidence: 0.9, dmConfidence: 0.9 }));
    assert.strictEqual(r.verdict, 'LOOK');
    assert.match(r.why, /no decision-maker name/);
  });
  await test('assignVerdict never throws and always returns one of REACH/LOOK/DROP for any input shape', () => {
    const r = D.assignVerdict(rec({ gateConfidence: 0.6, dmConfidence: 0.6, email: null, linkedinResolved: false }));
    assert.ok(['REACH', 'LOOK', 'DROP'].includes(r.verdict));
    assert.ok(r.why);
  });
  await test('assignVerdict does not mutate its input (accreting-merge, pure)', () => {
    const input = rec({ email: 'jane@acme.com', gateConfidence: 0.9, dmConfidence: 0.9 });
    const before = JSON.stringify(input);
    D.assignVerdict(input);
    assert.strictEqual(JSON.stringify(input), before);
  });
  await test('withVerdicts leaves an already-verdicted record untouched (no recompute)', () => {
    const already = { ...rec({ dropReason: 'boom' }), verdict: 'LOOK', why: 'manually overridden' };
    const [r] = D.withVerdicts([already]);
    assert.strictEqual(r.verdict, 'LOOK');
    assert.strictEqual(r.why, 'manually overridden');
  });

  // ================= splitBuckets =================
  await test('splitBuckets: emailLead = small-direct + REACH + safe email', () => {
    const records = [rec({ jobId: 'A', lane: 'small-direct', email: 'a@acme.com', reoonStatus: 'safe', gateConfidence: 0.9, dmConfidence: 0.9 })];
    const b = D.splitBuckets(records);
    assert.strictEqual(b.emailLead.length, 1);
    assert.strictEqual(b.emailLead[0].jobId, 'A');
  });
  await test('splitBuckets: small-direct REACH-eligible record WITHOUT a safe email is excluded from emailLead', () => {
    const records = [rec({ jobId: 'B', lane: 'small-direct', email: 'b@acme.com', reoonStatus: 'invalid', linkedinResolved: true, dmLinkedIn: 'https://linkedin.com/in/b', gateConfidence: 0.9, dmConfidence: 0.9 })];
    const b = D.splitBuckets(records);
    assert.strictEqual(b.emailLead.length, 0);
  });
  await test('splitBuckets: prospConnect = mid-augmentation + linkedinResolved', () => {
    const records = [rec({ jobId: 'C', lane: 'mid-augmentation', linkedinResolved: true, dmLinkedIn: 'https://linkedin.com/in/c', gateConfidence: 0.7, dmConfidence: 0.7 })];
    const b = D.splitBuckets(records);
    assert.strictEqual(b.prospConnect.length, 1);
    assert.strictEqual(b.prospConnect[0].jobId, 'C');
  });
  await test('splitBuckets: mid-augmentation WITHOUT linkedinResolved is excluded from prospConnect', () => {
    const records = [rec({ jobId: 'D', lane: 'mid-augmentation', linkedinResolved: false, gateConfidence: 0.7, dmConfidence: 0.7 })];
    const b = D.splitBuckets(records);
    assert.strictEqual(b.prospConnect.length, 0);
  });
  await test('splitBuckets: manualFind = hot but no contact', () => {
    const records = [rec({ jobId: 'E', email: null, linkedinResolved: false, gateConfidence: 0.8, dmConfidence: 0.8 })];
    const b = D.splitBuckets(records);
    assert.strictEqual(b.manualFind.length, 1);
    assert.strictEqual(b.manualFind[0].jobId, 'E');
  });
  await test('splitBuckets: websitePitch = lane website-pitch', () => {
    const records = [rec({ jobId: 'F', lane: 'website-pitch', companyDomain: null })];
    const b = D.splitBuckets(records);
    assert.strictEqual(b.websitePitch.length, 1);
    assert.strictEqual(b.websitePitch[0].jobId, 'F');
  });
  await test('splitBuckets: dropped = every DROP verdict, exhaustively', () => {
    const records = [
      rec({ jobId: 'G1', dropReason: 'recruiter' }),
      rec({ jobId: 'G2', gateConfidence: 0.1, dmConfidence: 0.9 }),
      rec({ jobId: 'G3', email: 'g3@acme.com', gateConfidence: 0.9, dmConfidence: 0.9 }), // REACH, not dropped
    ];
    const b = D.splitBuckets(records);
    assert.strictEqual(b.dropped.length, 2);
    assert.deepStrictEqual(b.dropped.map(r => r.jobId).sort(), ['G1', 'G2']);
  });
  await test('splitBuckets covers all five keys even on an empty input', () => {
    const b = D.splitBuckets([]);
    assert.deepStrictEqual(Object.keys(b).sort(), ['dropped', 'emailLead', 'manualFind', 'prospConnect', 'websitePitch'].sort());
    for (const k of Object.keys(b)) assert.deepStrictEqual(b[k], []);
  });

  // ================= renderDigest =================
  await test('renderDigest is safe on empty input (no throw, zero counts, "No records.")', () => {
    const out = D.renderDigest([]);
    assert.match(out, /Total records: 0/);
    assert.match(out, /No records\./);
  });
  await test('renderDigest contains a summary header with verdict + lane counts', () => {
    const records = [
      rec({ jobId: 'I1', email: 'i1@acme.com', gateConfidence: 0.9, dmConfidence: 0.9 }),
      rec({ jobId: 'I2', dropReason: 'recruiter' }),
    ];
    const out = D.renderDigest(records);
    assert.match(out, /Total records: 2/);
    assert.match(out, /REACH 1/);
    assert.match(out, /DROP 1/);
  });
  await test('renderDigest contains expected company/role rows as a markdown table', () => {
    const records = [rec({ jobId: 'J2', companyName: 'Widgets & Co', roleTitle: 'SEO Manager', email: 'w@widgets.co', gateConfidence: 0.9, dmConfidence: 0.9 })];
    const out = D.renderDigest(records);
    assert.match(out, /\| Company \| One-liner \| Size \| Brand \| Role \| DM \| LinkedIn \| Email \| Verdict \|/);
    assert.match(out, /Widgets & Co/);
    assert.match(out, /SEO Manager/);
    assert.match(out, /w@widgets\.co/);
    assert.match(out, /REACH/);
  });
  await test('renderDigest groups by lane then brand (lane header precedes its brand sub-headers)', () => {
    const records = [
      rec({ jobId: 'K1', lane: 'small-direct', brand: 'kobestarr' }),
      rec({ jobId: 'K2', lane: 'mid-augmentation', brand: 'stripped' }),
    ];
    const out = D.renderDigest(records);
    const laneIdx = out.indexOf('## Lane: small-direct');
    const brandIdx = out.indexOf('### Brand: kobestarr');
    assert.ok(laneIdx !== -1 && brandIdx !== -1 && laneIdx < brandIdx, 'lane header must precede its brand sub-header');
    assert.ok(out.indexOf('## Lane: mid-augmentation') > laneIdx, 'small-direct lane precedes mid-augmentation per LANE_ORDER');
  });
  await test('renderDigest handles a record with no dm/email/linkedin gracefully (placeholder cells)', () => {
    const records = [rec({ jobId: 'L1', dmName: null, dmTitle: null, email: null, dmLinkedIn: null, companyOneLiner: null, gateConfidence: 0.1 })];
    const out = D.renderDigest(records);
    assert.ok(out.includes('| -'), 'blank fields render as the placeholder, not "undefined"/"null"');
    assert.ok(!out.includes('undefined') && !out.includes('null'));
  });
  await test('renderDigest escapes pipe characters in free-text fields', () => {
    const records = [rec({ jobId: 'M1', companyOneLiner: 'We do X | Y | Z', gateConfidence: 0.9, dmConfidence: 0.9, email: 'm@x.com' })];
    const out = D.renderDigest(records);
    assert.match(out, /We do X \\\| Y \\\| Z/);
  });
  await test('renderDigest groups records with no lane under "no-lane"', () => {
    const records = [rec({ jobId: 'N1', lane: null })];
    const out = D.renderDigest(records);
    assert.match(out, /## Lane: no-lane/);
  });

  console.log(`\n${passed} passed`);
})();
