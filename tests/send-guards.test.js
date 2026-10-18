// tests/send-guards.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), os = require('os');
const G = require('../shared/outreach-core/campaigns/send-guards');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sg-'));
const write = (dir, name, text) => { fs.writeFileSync(path.join(dir, name), text); return path.join(dir, name); };

// ---- data dir pinning ----
test('OA_DATA_DIR wins, in a worktree or not', () => {
  assert.strictEqual(G.resolveDataDir({ env: { OA_DATA_DIR: '/x/data' }, repoDir: '/r', dryRun: false, isWorktree: () => true }), path.resolve('/x/data'));
});

test('the default is the main checkout data dir', () => {
  const d = G.resolveDataDir({ env: {}, repoDir: '/r', dryRun: false, isWorktree: () => false });
  assert.strictEqual(d, G.DEFAULT_DATA_DIR);
  assert.match(d, /outreach-automation[\\/]data$/);
});

test('a live run from a worktree without OA_DATA_DIR is refused, naming the fix', () => {
  assert.throws(() => G.resolveDataDir({ env: {}, repoDir: '/wt', dryRun: false, isWorktree: () => true }), /OA_DATA_DIR/);
});

test('a dry run from a worktree is allowed and reads the main checkout ledgers', () => {
  assert.strictEqual(G.resolveDataDir({ env: {}, repoDir: '/wt', dryRun: true, isWorktree: () => true }), G.DEFAULT_DATA_DIR);
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

test('do-not-contact: a missing file means an empty list, not a crash', () => {
  const d = G.readDoNotContact('/nonexistent/dnc.txt');
  assert.strictEqual(d.emails.size + d.domains.size, 0);
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
