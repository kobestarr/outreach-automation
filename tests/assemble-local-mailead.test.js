// tests/assemble-local-mailead.test.js
// Runs the real script on a temp CSV: what matters is the file that comes out.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const { parseCSV } = require('../shared/outreach-core/csv/csv-util');

const SCRIPT = path.join(__dirname, '..', 'assemble-local-mailead.js');
const BASE = ['company_name', 'company_number', 'maps_name', 'maps_match', 'maps_category', 'maps_postcode', 'district', 'subcategory', 'website', 'owner_first', 'owner_last', 'email', 'email_rule'];
const FINDER_COLS = ['email_status', 'email_confidence', 'email_suggested', 'email_source'];

function assemble(header, rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asm-'));
  const inp = path.join(dir, 'final.csv'), out = path.join(dir, 'send.csv');
  const esc = v => `"${String(v).replace(/"/g, '""')}"`;
  fs.writeFileSync(inp, [header.join(','), ...rows.map(r => header.map(h => esc(r[h] ?? '')).join(','))].join('\n'));
  execFileSync(process.execPath, [SCRIPT, inp, '--out', out, '--claimed', path.join(dir, 'none.json')], { encoding: 'utf8' });
  const [h, ...body] = parseCSV(fs.readFileSync(out, 'utf8')).filter(r => r.length > 1);
  return { header: h, rows: body.map(r => Object.fromEntries(h.map((k, i) => [k, r[i]]))) };
}
const lead = (o = {}) => ({ company_name: 'ACME ROOFING LIMITED', company_number: '0001', maps_name: 'Acme Roofing', maps_match: 'yes', maps_category: 'Roofing Contractor',
  maps_postcode: 'M33 1AA', district: 'M33', subcategory: 'Roofers', website: 'https://acme.co.uk', owner_first: 'Anthony', owner_last: 'Millar',
  email: 'anthony@acme.co.uk', email_rule: 'finder-found', email_status: 'found', email_confidence: 'high', email_suggested: 'guess@acme.co.uk', email_source: 'finder', ...o });

test('email_status, email_confidence, email_source and email_rule survive; email_suggested never does', () => {
  const { header, rows } = assemble([...BASE, ...FINDER_COLS], [lead()]);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].email_status, 'found');
  assert.strictEqual(rows[0].email_confidence, 'high');
  assert.strictEqual(rows[0].email_source, 'finder');
  assert.strictEqual(rows[0].email_rule, 'finder-found');
  assert.ok(!header.includes('email_suggested'));
  assert.ok(!JSON.stringify(rows).includes('guess@acme.co.uk'));
});

test('a legacy file (no email_status column) stays legacy: no finder columns are invented', () => {
  const { header } = assemble(BASE, [lead()]);
  for (const c of FINDER_COLS) assert.ok(!header.includes(c), c);
});

test('fail closed: when the column exists a blank value stays blank in the output', () => {
  const { header, rows } = assemble([...BASE, ...FINDER_COLS], [lead({ email_status: '' })]);
  assert.ok(header.includes('email_status'));
  assert.strictEqual(rows[0].email_status, '');
});

test('nickname greeting works for finder-found just like owner-match: tony@ for Anthony is "Hi Tony"', () => {
  const { rows } = assemble([...BASE, ...FINDER_COLS], [lead({ email: 'tony@acme.co.uk' })]);
  assert.strictEqual(rows[0].first_name, 'Tony');
});

test('a finder-generic inbox greets the owner by the first name we hold', () => {
  const { rows } = assemble([...BASE, ...FINDER_COLS], [lead({ email: 'info@acme.co.uk', email_rule: 'finder-generic', email_status: 'found_generic', email_confidence: 'medium' })]);
  assert.strictEqual(rows[0].first_name, 'Anthony');
});

test('rows with no email are still skipped', () => {
  const { rows } = assemble([...BASE, ...FINDER_COLS], [lead({ email: '', email_status: 'not_found' })]);
  assert.strictEqual(rows.length, 0);
});
