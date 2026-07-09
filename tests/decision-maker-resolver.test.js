// tests/decision-maker-resolver.test.js
const assert = require('assert');
const R = require('../shared/outreach-core/enrichment/decision-maker-resolver.js');

let passed = 0;
const test = (name, fn) => Promise.resolve().then(fn).then(() => { passed++; console.log('  ok -', name); })
  .catch(e => { console.error('  FAIL -', name, '\n   ', e.message); process.exitCode = 1; });

(async () => {
  // ---- seniority ----
  await test('leadership titles => head/exec', () => {
    assert.strictEqual(R.roleSeniority('Head of Marketing'), 'head');
    assert.strictEqual(R.roleSeniority('Marketing Director'), 'head');
    assert.strictEqual(R.roleSeniority('Chief Marketing Officer'), 'exec');
    assert.strictEqual(R.roleSeniority('CFO'), 'exec');
    assert.ok(R.isLeadershipHire(R.roleSeniority('Head of Content')));
  });
  await test('IC titles => mid/junior', () => {
    assert.strictEqual(R.roleSeniority('Marketing Manager'), 'mid');
    assert.strictEqual(R.roleSeniority('Marketing Executive'), 'junior');
    assert.strictEqual(R.roleSeniority('Content Coordinator'), 'junior');
    assert.ok(!R.isLeadershipHire(R.roleSeniority('Marketing Manager')));
  });

  // ---- function ----
  await test('function detection', () => {
    assert.strictEqual(R.roleFunction('SEO Manager'), 'marketing');
    assert.strictEqual(R.roleFunction('Podcast Producer'), 'content');
    assert.strictEqual(R.roleFunction('Financial Controller'), 'finance');
    assert.strictEqual(R.roleFunction('Random Widget Turner'), 'other');
  });

  // ---- external recruiter guard ----
  await test('external recruiter detection', () => {
    assert.ok(R.isExternalRecruiter('jane@toptalent.com', 'acme.com'));   // different domain
    assert.ok(R.isExternalRecruiter('careers@acme.com', 'acme.com'));     // careers@ on-domain
    assert.ok(!R.isExternalRecruiter('rob@acme.com', 'acme.com'));        // real person on-domain
    assert.ok(!R.isExternalRecruiter(null, 'acme.com'));
  });

  // ---- name matching (CH fuzzy guard) ----
  await test('nameMatchScore drops weak company matches', () => {
    assert.ok(R.nameMatchScore('Monzo Bank Ltd', 'Monzo Bank Limited') > 0.9);
    assert.ok(R.nameMatchScore('Monzo', 'Bramand Ltd') < 0.2);
  });
  await test('personMatch handles "SURNAME, First Middle" vs "First Surname"', () => {
    assert.ok(R.personMatch('BOYLE, Michael John', 'Michael Boyle') >= 0.8);
    assert.ok(R.personMatch('Rob Fia', 'Jane Smith') < 0.3);
  });

  // ---- classify: the decision tree ----
  await test('small company => founder target regardless of role', () => {
    const p = R.classify({ companyHeadcount: 8, roleTitle: 'Marketing Manager', brand: 'kobestarr' });
    assert.strictEqual(p.segment, 'small-founder');
    assert.strictEqual(p.targetKind, 'founder');
    assert.strictEqual(p.routes[0], 'companiesHouse');
  });
  await test('mid company hiring a HEAD => founder target (empty seat, hot)', () => {
    const p = R.classify({ companyHeadcount: 80, roleTitle: 'Head of Marketing', brand: 'kobestarr' });
    assert.strictEqual(p.segment, 'leadership-hire');
    assert.strictEqual(p.targetKind, 'founder');
    assert.ok(p.flags.hotVacancy);
  });
  await test('mid company hiring an IC => departmental head target, NOT ceo', () => {
    const p = R.classify({ companyHeadcount: 80, roleTitle: 'SEO Executive', brand: 'kobestarr' });
    assert.strictEqual(p.segment, 'mid-ic-hire');
    assert.strictEqual(p.targetKind, 'head');
    assert.ok(p.targetTitles.includes('Head of Marketing'));
    assert.strictEqual(p.routes[0], 'jdReportingLine'); // head routes lead with JD/LinkedIn
  });
  await test('dealflow brand => founder target always', () => {
    const p = R.classify({ companyHeadcount: 120, roleTitle: 'Senior Engineer', brand: 'dealflow' });
    assert.strictEqual(p.segment, 'dealflow-founder');
    assert.strictEqual(p.targetKind, 'founder');
  });
  await test('unknown size + IC => head-or-founder, tries both', () => {
    const p = R.classify({ companyHeadcount: null, roleTitle: 'Content Producer', brand: 'stripped' });
    assert.strictEqual(p.segment, 'unknown-size-ic');
    assert.strictEqual(p.targetKind, 'head-or-founder');
    assert.ok(p.targetTitles.includes('Head of Content'));
    assert.ok(p.targetTitles.includes('Founder'));
  });
  await test('too-large flagged', () => {
    const p = R.classify({ companyHeadcount: 5000, roleTitle: 'Marketing Manager', brand: 'kobestarr' });
    assert.ok(p.flags.tooLarge);
  });
  await test('recruiter poster flagged in classify', () => {
    const p = R.classify({ companyHeadcount: 10, roleTitle: 'x', posterEmail: 'hr@agency.com', companyDomain: 'acme.com' });
    assert.ok(p.flags.posterIsRecruiter);
  });

  // ---- resolve: orchestration with fake adapters ----
  const baseSignal = { companyName: 'Acme Ltd', companyDomain: 'acme.com', companyHeadcount: 6, roleTitle: 'Marketing Manager', brand: 'kobestarr' };

  await test('two sources agreeing => high confidence', async () => {
    const io = {
      companiesHouse: async () => [{ name: 'BOYLE, Michael John', title: 'Director', source: 'companiesHouse' }],
      websiteTeam: async () => [{ name: 'Michael Boyle', title: 'Founder', email: 'mike@acme.com' }],
    };
    const r = await R.resolve(baseSignal, io);
    assert.strictEqual(r.person.name, 'BOYLE, Michael John');
    assert.strictEqual(r.person.email, 'mike@acme.com');
    assert.ok(r.confidence >= 0.9, 'confidence ' + r.confidence);
    assert.strictEqual(r.sources.length, 2);
  });

  await test('single source => moderate confidence', async () => {
    const io = { companiesHouse: async () => [{ name: 'Jane Owner', title: 'Director' }] };
    const r = await R.resolve(baseSignal, io);
    assert.strictEqual(r.person.name, 'Jane Owner');
    assert.ok(r.confidence >= 0.7 && r.confidence < 0.9);
  });

  await test('recruiter poster excluded as a candidate', async () => {
    const sig = { ...baseSignal, posterName: 'Sam Recruiter', posterEmail: 'sam@agency.com', companyDomain: 'acme.com' };
    const io = {
      linkedinPeople: async () => [{ name: 'Sam Recruiter', title: 'Talent Partner' }, { name: 'Real Founder', title: 'CEO' }],
    };
    const r = await R.resolve(sig, io);
    assert.strictEqual(r.person.name, 'Real Founder');
    assert.ok(!r.candidates.some(c => c.name === 'Sam Recruiter'));
  });

  await test('wrong-function title gets downgraded below a founder match', async () => {
    const sig = { ...baseSignal, companyHeadcount: 90, roleTitle: 'SEO Executive' }; // head target = marketing
    const io = {
      linkedinPeople: async () => [{ name: 'Head Marketer', title: 'Head of Marketing', source: 'linkedinPeople' }],
      websiteTeam: async () => [{ name: 'Finance Person', title: 'Head of Finance' }],
    };
    const r = await R.resolve(sig, io);
    assert.strictEqual(r.person.name, 'Head Marketer'); // right-function head wins
  });

  await test('no candidates => null person, confidence 0', async () => {
    const r = await R.resolve(baseSignal, { companiesHouse: async () => [] });
    assert.strictEqual(r.person, null);
    assert.strictEqual(r.confidence, 0);
  });

  console.log(`\n${passed} passed`);
})();
