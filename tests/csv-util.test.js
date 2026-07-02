const { test } = require('node:test');
const assert = require('node:assert');
const { parseCSV, toCSV } = require('../shared/outreach-core/csv/csv-util');

test('parses quoted fields with commas and escaped quotes', () => {
  const rows = parseCSV('a,b\n"x, y","say ""hi"""\n');
  assert.deepStrictEqual(rows, [['a', 'b'], ['x, y', 'say "hi"']]);
});

test('strips UTF-8 BOM from first header', () => {
  const rows = parseCSV('﻿Organization Name,Website\nAcme,https://acme.com\n');
  assert.strictEqual(rows[0][0], 'Organization Name');
});

test('handles CRLF and trailing newline', () => {
  const rows = parseCSV('a,b\r\n1,2\r\n');
  assert.deepStrictEqual(rows, [['a', 'b'], ['1', '2']]);
});

test('toCSV escapes commas, quotes and newlines', () => {
  const s = toCSV([['a', 'b'], ['x, y', 'say "hi"\nline2']]);
  assert.strictEqual(s, 'a,b\n"x, y","say ""hi""\nline2"\n');
});

test('round-trips', () => {
  const rows = [['h1', 'h2'], ['plain', 'with, comma']];
  assert.deepStrictEqual(parseCSV(toCSV(rows)), rows);
});
