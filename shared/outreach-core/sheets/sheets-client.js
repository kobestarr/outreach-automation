// shared/outreach-core/sheets/sheets-client.js
// Google Sheets v4 REST client via service-account JWT. No external deps.
// Refactored from push-to-sheet.js. Creds: ~/.credentials/outreach-sheets-sa.json
const crypto = require('crypto'), path = require('path'), os = require('os');

const KEY_PATH = path.join(os.homedir(), '.credentials/outreach-sheets-sa.json');
let KEY = null;
function key() { if (!KEY) KEY = require(KEY_PATH); return KEY; }

const b64url = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// token cache per scope set (tokens live 1h; cache for 50min)
const tokCache = {};
async function getToken(scope = 'https://www.googleapis.com/auth/spreadsheets') {
  const hit = tokCache[scope];
  if (hit && hit.exp > Date.now()) return hit.tok;
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({ iss: key().client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const unsigned = head + '.' + claim;
  const sig = b64url(crypto.createSign('RSA-SHA256').update(unsigned).sign(key().private_key));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + sig })
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('TOKEN ERROR: ' + JSON.stringify(j));
  tokCache[scope] = { tok: j.access_token, exp: Date.now() + 50 * 60 * 1000 };
  return j.access_token;
}

function extractSheetId(urlOrId) {
  const m = String(urlOrId).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : String(urlOrId);
}

async function api(url, opts = {}, scope) {
  const tok = await getToken(scope);
  const r = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const j = await r.json();
  if (j.error) throw new Error(`Sheets API error: ${JSON.stringify(j.error)}`);
  return j;
}

// Read a whole tab, return the values under headerName (excludes header row).
async function readColumn(sheetId, tab, headerName) {
  const j = await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(tab)}`);
  const values = j.values || [];
  if (!values.length) return [];
  const idx = values[0].indexOf(headerName);
  if (idx < 0) return [];
  return values.slice(1).map(r => r[idx] || '').filter(v => v !== '');
}

// Append rows; write header first iff the tab is empty (A1 check).
async function appendRows(sheetId, tab, header, dataRows) {
  const chk = await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(tab)}!A1:A1`);
  const empty = !chk.values || !chk.values.length;
  const values = empty ? [header, ...dataRows] : dataRows;
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(tab)}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values }) });
  return { appended: dataRows.length, wroteHeader: empty };
}

// Create a spreadsheet (SA-owned) with one tab, share Editor with an email.
// Sharing needs the Drive scope; creation works with the spreadsheets scope.
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
async function createSpreadsheet(title, tab, shareWithEmail) {
  const created = await api('https://sheets.googleapis.com/v4/spreadsheets',
    { method: 'POST', body: JSON.stringify({ properties: { title }, sheets: [{ properties: { title: tab } }] }) });
  const sheetId = created.spreadsheetId;
  await api(`https://www.googleapis.com/drive/v3/files/${sheetId}/permissions?sendNotificationEmail=false`,
    { method: 'POST', body: JSON.stringify({ role: 'writer', type: 'user', emailAddress: shareWithEmail }) }, DRIVE_SCOPE);
  return { sheetId, url: 'https://docs.google.com/spreadsheets/d/' + sheetId };
}

module.exports = { getToken, extractSheetId, readColumn, appendRows, createSpreadsheet };
