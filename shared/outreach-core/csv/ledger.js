// Global sent-ledger: one lowercased email per line. Append-only, dedupes on write.
const fs = require('fs'), path = require('path');

function readLedger(file) {
  if (!fs.existsSync(file)) return new Set();
  return new Set(fs.readFileSync(file, 'utf8').split(/\r?\n/).map(l => l.trim().toLowerCase()).filter(Boolean));
}

function appendLedger(file, emails) {
  const existing = readLedger(file);
  const fresh = [...new Set(emails.map(e => String(e).trim().toLowerCase()))].filter(e => e && !existing.has(e));
  if (!fresh.length) return 0;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, fresh.join('\n') + '\n');
  return fresh.length;
}

module.exports = { readLedger, appendLedger };
