// Single shared CSV parse/serialise. Strips UTF-8 BOM (LeadByte drops carry one).

function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c !== '\r') cur += c;
    }
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function csvField(v) {
  v = String(v == null ? '' : v);
  return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

function toCSV(rows) {
  return rows.map(r => r.map(csvField).join(',')).join('\n') + '\n';
}

module.exports = { parseCSV, toCSV, csvField };
