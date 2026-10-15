// tests/website-scraper-extract.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { extractEmails } = require('../shared/outreach-core/enrichment/website-scraper');

test('extractEmails finds Cloudflare-protected and [at]-obfuscated emails', () => {
  const key = 0x5a, plain = 'office@acme.co.uk';
  const hex = key.toString(16) + [...plain].map(c => (c.charCodeAt(0) ^ key).toString(16).padStart(2, '0')).join('');
  const html = `<a data-cfemail="${hex}">[email&#160;protected]</a> or write to tony [at] acme [dot] co.uk`;
  assert.deepStrictEqual(extractEmails(html).sort(), ['office@acme.co.uk', 'tony@acme.co.uk']);
});

test('extractEmails still finds plain emails and still drops image@2x junk', () => {
  assert.deepStrictEqual(extractEmails('<p>info@acme.co.uk</p><img src="logo@2x.png">'), ['info@acme.co.uk']);
});
