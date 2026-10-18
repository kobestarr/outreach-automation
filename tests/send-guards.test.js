// tests/send-guards.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), os = require('os');
const G = require('../shared/outreach-core/campaigns/send-guards');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sg-'));
const write = (dir, name, text) => { fs.writeFileSync(path.join(dir, name), text); return path.join(dir, name); };

// ---- data dir pinning ----
const gateDir = (files = ['sent-ledger.txt', 'do-not-contact.txt']) => { const d = tmp(); files.forEach(f => fs.writeFileSync(path.join(d, f), '')); return d; };

test('OA_DATA_DIR wins, in a worktree or not, when it holds the gate files', () => {
  const d = gateDir();
  assert.strictEqual(G.resolveDataDir({ env: { OA_DATA_DIR: d }, repoDir: '/r', dryRun: false, isWorktree: () => true }), path.resolve(d));
});

test('the default is the main checkout data dir (dry run: no gate-file check)', () => {
  const d = G.resolveDataDir({ env: {}, repoDir: '/r', dryRun: true, isWorktree: () => false });
  assert.strictEqual(d, G.DEFAULT_DATA_DIR);
  assert.match(d, /outreach-automation[\\/]data$/);
});

test('a live run from a worktree without OA_DATA_DIR is refused, naming the fix', () => {
  assert.throws(() => G.resolveDataDir({ env: {}, repoDir: '/wt', dryRun: false, isWorktree: () => true }), /OA_DATA_DIR/);
});

test('a dry run from a worktree is allowed and reads the main checkout ledgers', () => {
  assert.strictEqual(G.resolveDataDir({ env: {}, repoDir: '/wt', dryRun: true, isWorktree: () => true }), G.DEFAULT_DATA_DIR);
});

test('live: a data dir that does not exist, or lacks sent-ledger.txt or do-not-contact.txt, is refused (fail closed)', () => {
  assert.throws(() => G.resolveDataDir({ env: { OA_DATA_DIR: '/nonexistent/nowhere' }, dryRun: false, isWorktree: () => false }), /does not exist/);
  assert.throws(() => G.resolveDataDir({ env: { OA_DATA_DIR: gateDir(['do-not-contact.txt']) }, dryRun: false, isWorktree: () => false }), /sent-ledger\.txt/);
  assert.throws(() => G.resolveDataDir({ env: { OA_DATA_DIR: gateDir(['sent-ledger.txt']) }, dryRun: false, isWorktree: () => false }), /do-not-contact\.txt/);
});

test('dry run with a bad OA_DATA_DIR is allowed (it only previews)', () => {
  assert.strictEqual(G.resolveDataDir({ env: { OA_DATA_DIR: '/nonexistent/nowhere' }, dryRun: true, isWorktree: () => false }), path.resolve('/nonexistent/nowhere'));
});

test('assertGateFiles passes with both files present', () => {
  assert.doesNotThrow(() => G.assertGateFiles(gateDir()));
});

test('isWorktreeDir: .git as a file is a worktree, a directory is a checkout, missing is not', () => {
  const wt = tmp(), co = tmp(), none = tmp();
  fs.writeFileSync(path.join(wt, '.git'), 'gitdir: /somewhere');
  fs.mkdirSync(path.join(co, '.git'));
  assert.strictEqual(G.isWorktreeDir(wt), true);
  assert.strictEqual(G.isWorktreeDir(co), false);
  assert.strictEqual(G.isWorktreeDir(none), false);
});

// ---- do-not-contact ----
test('do-not-contact: emails, @domain and bare domain entries, comments and tab reasons', () => {
  const dir = tmp();
  const f = write(dir, 'dnc.txt', '# comment\n\nHarrison@TACCS.co.uk\tasked to be removed\n@blocked.com\treason\nfirmcorp.co.uk\twhole firm\n');
  const d = G.readDoNotContact(f);
  assert.ok(d.emails.has('harrison@taccs.co.uk'));
  assert.ok(d.domains.has('blocked.com'));
  assert.ok(d.domains.has('firmcorp.co.uk'));
  assert.strictEqual(d.emails.size, 1);
  assert.strictEqual(G.isDoNotContact(d, { email: 'harrison@taccs.co.uk' }), 'do_not_contact_email');
  assert.strictEqual(G.isDoNotContact(d, { email: 'anyone@blocked.com' }), 'do_not_contact_domain');
  assert.strictEqual(G.isDoNotContact(d, { email: 'x@mail.blocked.com' }), 'do_not_contact_domain');
  assert.strictEqual(G.isDoNotContact(d, { email: 'x@gmail.com', website: 'https://www.firmcorp.co.uk/about' }), 'do_not_contact_domain');
  assert.strictEqual(G.isDoNotContact(d, { email: 'ok@fine.co.uk', website: 'https://fine.co.uk' }), null);
});

test('do-not-contact: a missing file is empty ONLY in a dry run; live it throws', () => {
  const d = G.readDoNotContact('/nonexistent/dnc.txt');
  assert.strictEqual(d.emails.size + d.domains.size, 0);
  assert.throws(() => G.readDoNotContact('/nonexistent/dnc.txt', { required: true }), /do-not-contact/);
});

test('company ledger: a missing file is empty only in a dry run; live it throws', () => {
  assert.strictEqual(G.readCompanyLedger('/nonexistent/c.txt').numbers.size, 0);
  assert.throws(() => G.readCompanyLedger('/nonexistent/c.txt', { required: true }), /company-ledger/);
});

// ---- domains ----
test('domainOf strips scheme, www, path and port; freemail and platform domains are not firm domains', () => {
  assert.strictEqual(G.domainOf('https://www.Acme.co.uk/contact?x=1'), 'acme.co.uk');
  assert.strictEqual(G.domainOf('acme.co.uk:8080'), 'acme.co.uk');
  assert.strictEqual(G.domainOf(''), '');
  assert.strictEqual(G.firmDomain('https://acme.co.uk'), 'acme.co.uk');
  assert.strictEqual(G.firmDomain('https://www.gmail.com'), '');
  assert.strictEqual(G.firmDomain('https://www.facebook.com/acme'), '');
  assert.strictEqual(G.firmDomain('https://acme.wixsite.com/site'), '');
  assert.strictEqual(G.firmDomain('https://sites.google.com/view/acme'), '');
});

// ---- company ledger ----
test('company ledger round-trips company_number<TAB>domain and ignores blanks', () => {
  const dir = tmp(), f = path.join(dir, 'company-ledger.txt');
  G.appendCompanyLedger(f, [{ company_number: '0001', domain: 'acme.co.uk' }, { company_number: '', domain: 'b.co.uk' }, { company_number: '0003', domain: '' }, { company_number: '', domain: '' }]);
  assert.strictEqual(fs.readFileSync(f, 'utf8'), '0001\tacme.co.uk\n\tb.co.uk\n0003\t\n');
  const l = G.readCompanyLedger(f);
  assert.deepStrictEqual([...l.numbers].sort(), ['0001', '0003']);
  assert.deepStrictEqual([...l.domains].sort(), ['acme.co.uk', 'b.co.uk']);
  assert.strictEqual(G.appendCompanyLedger(f, [{ company_number: '0001', domain: 'acme.co.uk' }]), 0, 'no duplicates appended');
});

test('seeding the company ledger from mailead-loaded-*.txt adds each loaded domain once, freemail excluded', () => {
  const dir = tmp();
  write(dir, 'mailead-loaded-1-a.txt', 'info@acme.co.uk\nbob@gmail.com\nann@acme.co.uk\n');
  write(dir, 'mailead-loaded-2-b.txt', 'x@beta.com\n');
  write(dir, 'other.txt', 'nope@zzz.com\n');
  assert.deepStrictEqual([...G.loadedDomains(dir)].sort(), ['acme.co.uk', 'beta.com']);
  assert.strictEqual(G.seedCompanyLedger(dir), 2);
  assert.strictEqual(G.seedCompanyLedger(dir), 0, 'idempotent');
  assert.deepStrictEqual([...G.readCompanyLedger(path.join(dir, 'company-ledger.txt')).domains].sort(), ['acme.co.uk', 'beta.com']);
});

test('loadedDomains also reads the sent ledger', () => {
  const dir = tmp();
  write(dir, 'sent-ledger.txt', 'a@old.co.uk\n');
  assert.ok(G.loadedDomains(dir).has('old.co.uk'));
});

// ---- firm dedupe in file ----
const L = (email, route, website, company_number) => ({ lead: { email, website, ref: { company_number } }, route });

test('firm dedupe: same website domain keeps the best route (main over inbox over probable), file order breaks ties', () => {
  const items = [L('info@a.co.uk', 'inbox', 'https://a.co.uk', '1'), L('anthony@a.co.uk', 'main', 'https://www.a.co.uk', '1'), L('p@a.co.uk', 'probable', 'https://a.co.uk/x', '1'),
    L('b1@b.co.uk', 'main', 'https://b.co.uk', '2'), L('b2@b.co.uk', 'main', 'https://b.co.uk', '2')];
  const { kept, dropped } = G.dedupeFirms(items);
  assert.deepStrictEqual(kept.map(i => i.lead.email), ['anthony@a.co.uk', 'b1@b.co.uk']);
  assert.deepStrictEqual(dropped.map(d => d.email).sort(), ['b2@b.co.uk', 'info@a.co.uk', 'p@a.co.uk']);
  assert.ok(dropped.every(d => d.reason === 'firm_dupe_in_file'));
});

test('firm dedupe: same company number with different websites is one firm', () => {
  const { kept } = G.dedupeFirms([L('a@one.co.uk', 'inbox', 'https://one.co.uk', '77'), L('b@two.co.uk', 'main', 'https://two.co.uk', '77')]);
  assert.deepStrictEqual(kept.map(i => i.lead.email), ['b@two.co.uk']);
});

test('firm dedupe: two rows sharing a domain but with different company numbers are still one firm; blank numbers never match each other', () => {
  const same = G.dedupeFirms([L('a@x.co.uk', 'main', 'https://x.co.uk', '1'), L('b@x.co.uk', 'main', 'https://x.co.uk', '2')]);
  assert.strictEqual(same.kept.length, 1);
  const blanks = G.dedupeFirms([L('a@x.co.uk', 'main', '', ''), L('b@y.co.uk', 'main', '', '')]);
  assert.strictEqual(blanks.kept.length, 2);
});

test('firm dedupe: freemail and platform websites never collapse different firms', () => {
  const { kept } = G.dedupeFirms([L('a@gmail.com', 'main', 'https://facebook.com/a', '1'), L('b@gmail.com', 'main', 'https://facebook.com/b', '2'), L('c@hotmail.co.uk', 'main', 'https://acme.wixsite.com/c', '3')]);
  assert.strictEqual(kept.length, 3);
});

test('firm dedupe keeps the original file order of the survivors', () => {
  const { kept } = G.dedupeFirms([L('x@a.co.uk', 'inbox', 'https://a.co.uk', '1'), L('y@b.co.uk', 'main', 'https://b.co.uk', '2'), L('z@a.co.uk', 'main', 'https://a.co.uk', '1')]);
  assert.deepStrictEqual(kept.map(i => i.lead.email), ['y@b.co.uk', 'z@a.co.uk']);
});

// ---- already-loaded firm check ----
test('firmSeen: company number, domain, or a domain seen in a loaded email', () => {
  const ctx = { companyNumbers: new Set(['0001']), domains: new Set(['acme.co.uk']) };
  assert.strictEqual(G.firmSeen(ctx, { website: 'https://other.co.uk', ref: { company_number: '0001' } }), 'firm_already_loaded_company_number');
  assert.strictEqual(G.firmSeen(ctx, { website: 'https://www.acme.co.uk', ref: {} }), 'firm_already_loaded_domain');
  assert.strictEqual(G.firmSeen(ctx, { website: 'https://new.co.uk', ref: { company_number: '9' } }), null);
  assert.strictEqual(G.firmSeen(ctx, { website: 'https://gmail.com', ref: {} }), null);
});

// ---- shared domains (data-driven) ----
test('shared multi-firm domains are never firm keys: the real top offenders', () => {
  for (const d of ['doctors.org.uk', 'rbht.nhs.uk', 'taxassist.co.uk', 'nhs.net', 'wales.nhs.uk', 'imperial.ac.uk', 'btconnect.com', 'btinternet.com', 'www.nhs.net']) {
    assert.strictEqual(G.isSharedDomain(d), true, d);
    assert.strictEqual(G.firmDomain('https://' + d), '', d);
    assert.strictEqual(G.firmDomain('someone@' + d), '', d);
  }
  assert.strictEqual(G.isSharedDomain('acme.co.uk'), false);
  assert.strictEqual(G.isSharedDomain('notnhs.uk'), false, 'suffix match is on a dot boundary');
});

test('the shared list comes from config/shared-domains.json and a custom list can be supplied', () => {
  const f = path.join(tmp(), 's.json');
  fs.writeFileSync(f, JSON.stringify({ domains: ['bigfranchise.co.uk'] }));
  assert.deepStrictEqual(G.loadSharedDomains(f), ['bigfranchise.co.uk']);
  assert.ok(G.loadSharedDomains().includes('nhs.net'));
  assert.deepStrictEqual(G.loadSharedDomains('/nonexistent.json').slice(0, 1), G.FALLBACK_SHARED.slice(0, 1));
});

test('shared domains are not seeded into the company ledger, and are ignored on read if already there', () => {
  const dir = tmp();
  write(dir, 'mailead-loaded-1-a.txt', 'dr@doctors.org.uk\nx@rbht.nhs.uk\ny@taxassist.co.uk\nz@real.co.uk\n');
  assert.deepStrictEqual([...G.loadedDomains(dir)], ['real.co.uk']);
  G.seedCompanyLedger(dir);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'company-ledger.txt'), 'utf8'), '\treal.co.uk\n');
  const f = write(dir, 'old-ledger.txt', '1\tdoctors.org.uk\n2\tnhs.net\n3\tfine.co.uk\n');
  assert.deepStrictEqual([...G.readCompanyLedger(f).domains], ['fine.co.uk']);
  assert.strictEqual(G.appendCompanyLedger(path.join(dir, 'c2.txt'), [{ company_number: '', domain: 'imperial.ac.uk' }]), 0);
});

test('firmSeen and dedupeFirms never treat a shared domain as the same firm', () => {
  const ctx = { companyNumbers: new Set(), domains: new Set(['doctors.org.uk']) };
  assert.strictEqual(G.firmSeen(ctx, { website: '', email: 'dr@doctors.org.uk', ref: {} }), null);
  const { kept } = G.dedupeFirms([L('a@nhs.net', 'main', '', ''), L('b@nhs.net', 'main', '', '')]);
  assert.strictEqual(kept.length, 2);
});

// ---- email domain as firm key when the website is missing or a platform ----
test('firmKey: the website domain, else the email domain, never shared, platform or freemail', () => {
  assert.strictEqual(G.leadFirmDomain({ website: 'https://a.co.uk', email: 'x@b.co.uk' }), 'a.co.uk');
  assert.strictEqual(G.leadFirmDomain({ website: '', email: 'x@b.co.uk' }), 'b.co.uk');
  assert.strictEqual(G.leadFirmDomain({ website: 'https://facebook.com/x', email: 'x@b.co.uk' }), 'b.co.uk');
  assert.strictEqual(G.leadFirmDomain({ website: '', email: 'x@gmail.com' }), '');
  assert.strictEqual(G.leadFirmDomain({ website: '', email: 'x@nhs.net' }), '');
});

test('firm dedupe falls back to the email domain when there is no website', () => {
  const { kept, dropped } = G.dedupeFirms([L('a@same.co.uk', 'main', '', ''), L('b@same.co.uk', 'inbox', '', ''), L('c@other.co.uk', 'main', '', '')]);
  assert.deepStrictEqual(kept.map(i => i.lead.email), ['a@same.co.uk', 'c@other.co.uk']);
  assert.strictEqual(dropped.length, 1);
});

test('firmSeen uses the email domain when there is no website', () => {
  const ctx = { companyNumbers: new Set(), domains: new Set(['same.co.uk']) };
  assert.strictEqual(G.firmSeen(ctx, { website: '', email: 'q@same.co.uk', ref: {} }), 'firm_already_loaded_domain');
});
