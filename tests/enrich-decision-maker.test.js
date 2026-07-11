// tests/enrich-decision-maker.test.js — hermetic (verifyEmails/quotaRemaining/websiteEmailLookup
// all injected via io, no live Reoon calls). Exercises enrichDecisionMaker(signal, io), which adds
// email/reoonStatus/emailSource/contactConfidence/linkedinResolved onto a SignalRecord that
// already has resolver fields (dmName, dmTitle, dmLinkedIn, dmConfidence, dmSources) + companyDomain.
const assert = require('assert');
const E = require('../shared/outreach-core/enrichment/enrich-decision-maker.js');

let passed = 0;
const test = (name, fn) => Promise.resolve().then(fn).then(() => { passed++; console.log('  ok -', name); })
  .catch(e => { console.error('  FAIL -', name, '\n   ', e.message); process.exitCode = 1; });

function baseSignal(overrides = {}) {
  return {
    jobId: 'job-1',
    companyName: 'Acme Widgets Ltd',
    companyDomain: 'acmewidgets.co.uk',
    dmName: 'Jane Owner',
    dmTitle: 'Founder',
    dmLinkedIn: null,
    dmConfidence: 0.8,
    dmSources: [],
    ...overrides,
  };
}

(async () => {
  // ================= website-scraped email: auto-valid, no Reoon spend =================

  await test('website-scraped email for the person -> used directly, reoonStatus=website-valid, no verify calls', async () => {
    let verifyCalls = 0;
    const io = {
      websiteEmailLookup: async () => 'jane@acmewidgets.co.uk',
      verifyEmails: async () => { verifyCalls++; return []; },
      quotaRemaining: () => 500,
    };
    const out = await E.enrichDecisionMaker(baseSignal(), io);
    assert.strictEqual(out.email, 'jane@acmewidgets.co.uk');
    assert.strictEqual(out.emailSource, 'website');
    assert.strictEqual(out.reoonStatus, 'website-valid');
    assert.strictEqual(verifyCalls, 0); // never spends a Reoon credit on a website-scraped address
  });

  await test('website email lookup returning junk (invalid format) is rejected, falls through to pattern cascade', async () => {
    const io = {
      websiteEmailLookup: async () => 'not-an-email',
      verifyEmails: async (emails) => emails.map(email => ({ email, status: 'safe', score: 0.9, isSafeToSend: true })),
      quotaRemaining: () => 500,
    };
    const out = await E.enrichDecisionMaker(baseSignal(), io);
    assert.strictEqual(out.emailSource, 'pattern');
    assert.strictEqual(out.email, 'jane@acmewidgets.co.uk'); // first@ pattern, verified safe
  });

  // ================= pattern cascade + Reoon short-circuit =================

  await test('pattern cascade: short-circuits on the FIRST safe result (does not verify every pattern)', async () => {
    const calls = [];
    const io = {
      verifyEmails: async (emails) => {
        calls.push(...emails);
        // first@ (jane@...) comes back safe immediately
        return emails.map(email => ({ email, status: 'safe', score: 0.95, isSafeToSend: true }));
      },
      quotaRemaining: () => 500,
    };
    const out = await E.enrichDecisionMaker(baseSignal(), io);
    assert.strictEqual(out.email, 'jane@acmewidgets.co.uk');
    assert.strictEqual(out.emailSource, 'pattern');
    assert.strictEqual(out.reoonStatus, 'safe');
    assert.strictEqual(calls.length, 1); // only the first pattern was ever verified
    assert.deepStrictEqual(calls, ['jane@acmewidgets.co.uk']);
  });

  await test('pattern cascade: tries patterns in order first@, first.last@, flast@, firstlast@', async () => {
    const calls = [];
    const io = {
      verifyEmails: async (emails) => {
        calls.push(...emails);
        return emails.map(email => ({ email, status: 'unknown', score: 0.3, isSafeToSend: false }));
      },
      quotaRemaining: () => 500,
    };
    await E.enrichDecisionMaker(baseSignal(), io);
    assert.deepStrictEqual(calls, [
      'jane@acmewidgets.co.uk',
      'jane.owner@acmewidgets.co.uk',
      'jowner@acmewidgets.co.uk',
      'janeowner@acmewidgets.co.uk',
    ]);
  });

  await test('catch_all status -> email=null (only "safe" is ever kept)', async () => {
    const io = {
      verifyEmails: async (emails) => emails.map(email => ({ email, status: 'catch_all', score: 0.5, isSafeToSend: false })),
      quotaRemaining: () => 500,
    };
    const out = await E.enrichDecisionMaker(baseSignal(), io);
    assert.strictEqual(out.email, null);
    assert.strictEqual(out.emailSource, null);
    assert.strictEqual(out.reoonStatus, 'catch_all');
  });

  await test('unknown/invalid/disposable statuses across all patterns -> email=null, last status recorded', async () => {
    const io = {
      verifyEmails: async (emails) => emails.map(email => ({ email, status: 'invalid', score: 0.1, isSafeToSend: false })),
      quotaRemaining: () => 500,
    };
    const out = await E.enrichDecisionMaker(baseSignal(), io);
    assert.strictEqual(out.email, null);
    assert.strictEqual(out.emailSource, null);
    assert.strictEqual(out.reoonStatus, 'invalid');
  });

  // ================= quota / overflow guard =================

  await test('quota too low for this record\'s patterns -> stops before spending, marks overflow, never calls verifyEmails', async () => {
    let verifyCalls = 0;
    const io = {
      verifyEmails: async () => { verifyCalls++; return []; },
      quotaRemaining: () => 0,
    };
    const out = await E.enrichDecisionMaker(baseSignal(), io);
    assert.strictEqual(out.email, null);
    assert.strictEqual(out.emailSource, null);
    assert.strictEqual(out.reoonStatus, 'quota-low-overflow');
    assert.strictEqual(out.overflow, true);
    assert.strictEqual(verifyCalls, 0);
  });

  await test('quota healthy -> proceeds normally, no overflow flag', async () => {
    const io = {
      verifyEmails: async (emails) => emails.map(email => ({ email, status: 'safe', score: 0.9, isSafeToSend: true })),
      quotaRemaining: () => 500,
    };
    const out = await E.enrichDecisionMaker(baseSignal(), io);
    assert.strictEqual(out.overflow, undefined);
  });

  // ================= no dmName / no companyDomain: nothing to try =================

  await test('missing dmName -> no patterns generated, email stays null, reoonStatus null', async () => {
    let verifyCalls = 0;
    const io = { verifyEmails: async () => { verifyCalls++; return []; }, quotaRemaining: () => 500 };
    const out = await E.enrichDecisionMaker(baseSignal({ dmName: null }), io);
    assert.strictEqual(out.email, null);
    assert.strictEqual(out.emailSource, null);
    assert.strictEqual(out.reoonStatus, null);
    assert.strictEqual(verifyCalls, 0);
  });

  await test('missing companyDomain -> no patterns generated, email stays null', async () => {
    const io = { verifyEmails: async () => [], quotaRemaining: () => 500 };
    const out = await E.enrichDecisionMaker(baseSignal({ companyDomain: null }), io);
    assert.strictEqual(out.email, null);
    assert.strictEqual(out.emailSource, null);
  });

  // ================= LinkedIn: never accept a guessed/constructed URL =================

  await test('guessed/constructed LinkedIn URL (not sourced via linkedinPeople) is rejected', async () => {
    const io = { verifyEmails: async () => [], quotaRemaining: () => 500 };
    const signal = baseSignal({
      dmLinkedIn: 'https://www.linkedin.com/in/jane-owner', // exactly first-last, no provenance
      dmSources: ['companiesHouse'], // came from CH, which never returns a linkedinUrl -> untrustworthy if present
    });
    const out = await E.enrichDecisionMaker(signal, io);
    assert.strictEqual(out.dmLinkedIn, null);
    assert.strictEqual(out.linkedinResolved, false);
  });

  await test('no dmLinkedIn at all -> linkedinResolved=false, dmLinkedIn stays null', async () => {
    const io = { verifyEmails: async () => [], quotaRemaining: () => 500 };
    const out = await E.enrichDecisionMaker(baseSignal({ dmLinkedIn: null, dmSources: [] }), io);
    assert.strictEqual(out.dmLinkedIn, null);
    assert.strictEqual(out.linkedinResolved, false);
  });

  await test('real LinkedIn URL sourced via linkedinPeople search -> kept, linkedinResolved=true', async () => {
    const io = { verifyEmails: async () => [], quotaRemaining: () => 500 };
    const signal = baseSignal({
      dmLinkedIn: 'https://www.linkedin.com/in/priyashah123',
      dmSources: ['linkedinPeople'],
    });
    const out = await E.enrichDecisionMaker(signal, io);
    assert.strictEqual(out.dmLinkedIn, 'https://www.linkedin.com/in/priyashah123');
    assert.strictEqual(out.linkedinResolved, true);
  });

  await test('linkedinPeople-sourced URL kept even if its slug happens to look like first-last (real vanity slugs do)', async () => {
    const io = { verifyEmails: async () => [], quotaRemaining: () => 500 };
    const signal = baseSignal({
      dmLinkedIn: 'https://www.linkedin.com/in/jane-owner',
      dmSources: ['companiesHouse', 'linkedinPeople'], // two sources agreeing, one of them the real search
    });
    const out = await E.enrichDecisionMaker(signal, io);
    assert.strictEqual(out.dmLinkedIn, 'https://www.linkedin.com/in/jane-owner');
    assert.strictEqual(out.linkedinResolved, true);
  });

  // ================= contactConfidence =================

  await test('contactConfidence: high when website email + high dmConfidence', async () => {
    const io = {
      websiteEmailLookup: async () => 'jane@acmewidgets.co.uk',
      verifyEmails: async () => [], quotaRemaining: () => 500,
    };
    const out = await E.enrichDecisionMaker(baseSignal({ dmConfidence: 0.9 }), io);
    assert.ok(out.contactConfidence > 0.8, `expected high confidence, got ${out.contactConfidence}`);
    assert.ok(out.contactConfidence <= 1);
  });

  await test('contactConfidence: zero when no email and no confirmed LinkedIn', async () => {
    const io = {
      verifyEmails: async (emails) => emails.map(email => ({ email, status: 'invalid', score: 0, isSafeToSend: false })),
      quotaRemaining: () => 500,
    };
    const out = await E.enrichDecisionMaker(baseSignal({ dmConfidence: 0.8 }), io);
    assert.strictEqual(out.contactConfidence, 0);
  });

  await test('contactConfidence: some credit for a confirmed LinkedIn even without an email', async () => {
    const io = { verifyEmails: async () => [], quotaRemaining: () => 500 };
    const signal = baseSignal({
      dmConfidence: 0.8,
      dmLinkedIn: 'https://www.linkedin.com/in/priyashah123',
      dmSources: ['linkedinPeople'],
    });
    const out = await E.enrichDecisionMaker(signal, io);
    assert.ok(out.contactConfidence > 0, `expected some confidence from confirmed LinkedIn, got ${out.contactConfidence}`);
    assert.ok(out.contactConfidence < 0.8); // still less than a full email-backed confidence
  });

  // ================= record accretion: never drops existing fields =================

  await test('enrichDecisionMaker returns the FULL record (accreting merge), not a stripped-down object', async () => {
    const io = { verifyEmails: async () => [], quotaRemaining: () => 500 };
    const out = await E.enrichDecisionMaker(baseSignal({ jobUrl: 'https://example.com/job/1', brand: 'kobestarr' }), io);
    assert.strictEqual(out.jobId, 'job-1');
    assert.strictEqual(out.jobUrl, 'https://example.com/job/1');
    assert.strictEqual(out.brand, 'kobestarr');
    assert.strictEqual(out.dmName, 'Jane Owner');
  });

  console.log(`\n${passed} passed`);
})();
