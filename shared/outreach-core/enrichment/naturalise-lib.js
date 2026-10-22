// Helpers for naturalise-company-names.js: which names are already cleaned, and how to send the rest.
const CHUNK_SIZE = 60;
const TOKENS_PER_NAME = 70;
const HEADER = 'FULL\tSHORT\tCHANGED\tSTATUS';

// Only names the model actually returned (STATUS "model") count as cleaned. Rows from the old 3-column
// format and names the model left out are sent again.
function parseCache(tsv) {
  const map = new Map();
  for (const line of String(tsv).split('\n').slice(1)) {
    const [full, short, , status] = line.split('\t');
    if (full && short && status === 'model') map.set(full, short);
  }
  return map;
}

function chunk(items, size = CHUNK_SIZE) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const maxTokensFor = (n) => Math.min(8000, 300 + TOKENS_PER_NAME * n);

// returned: Map of names the model gave back this run or earlier. Unreturned names keep their full form.
function buildReview(allCompanies, returned) {
  const row = (c) => {
    const got = returned.has(c);
    const short = got ? returned.get(c) : c;
    return { c, short, changed: short !== c, status: got ? 'model' : 'unreturned' };
  };
  const rows = allCompanies.map(row);
  const fmt = (r) => `${r.c}\t${r.short}\t${r.changed ? 'YES' : '-'}\t${r.status}`;
  return [HEADER, ...rows.filter((r) => r.changed).map(fmt), ...rows.filter((r) => !r.changed).map(fmt)].join('\n');
}

module.exports = { CHUNK_SIZE, TOKENS_PER_NAME, parseCache, chunk, maxTokensFor, buildReview };
