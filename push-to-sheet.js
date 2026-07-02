#!/usr/bin/env node
// Append a Mailead-ready CSV to the ToSend staging sheet (the TaskMagic -> Mailead
// pickup point). Auth: service-account JWT (no external deps). APPENDS rows (writes
// the header once if the tab is empty), so it can be called every batch.
//
// Usage: node push-to-sheet.js <sheet URL or ID> <csv path> [--tab ToSend]
// The robot account can only FILL an existing sheet: create the sheet first and
// share it (Editor) with the service account, then pass its URL/ID here.
const fs = require('fs'), crypto = require('crypto'), path = require('path'), os = require('os');
const KEY = require(path.join(os.homedir(), '.credentials/outreach-sheets-sa.json'));

function parse(t){const r=[];let row=[],f='',q=false;for(let i=0;i<t.length;i++){const c=t[i];if(q){if(c==='"'&&t[i+1]==='"'){f+='"';i++}else if(c==='"'){q=false}else f+=c}else{if(c==='"')q=true;else if(c===','){row.push(f);f=''}else if(c==='\n'){row.push(f);r.push(row);row=[];f=''}else if(c==='\r'){}else f+=c}}if(f.length||row.length){row.push(f);r.push(row)}return r}
const b64url = b => Buffer.from(b).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');

async function getToken(){
  const now = Math.floor(Date.now()/1000);
  const head = b64url(JSON.stringify({alg:'RS256',typ:'JWT'}));
  const claim = b64url(JSON.stringify({iss:KEY.client_email,scope:'https://www.googleapis.com/auth/spreadsheets',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}));
  const unsigned = head+'.'+claim;
  const sig = b64url(crypto.createSign('RSA-SHA256').update(unsigned).sign(KEY.private_key));
  const r = await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:unsigned+'.'+sig})});
  const j = await r.json(); if(!j.access_token){console.error('TOKEN ERROR:',JSON.stringify(j));process.exit(1)} return j.access_token;
}

(async () => {
  const args = process.argv.slice(2);
  const sheetArg = args.find(a => !a.startsWith('--')) || '';
  const csvArg = args.filter(a => !a.startsWith('--'))[1];
  const tab = (() => { const i = args.indexOf('--tab'); return i >= 0 ? args[i+1] : 'ToSend'; })();
  const m = sheetArg.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  const sheetId = m ? m[1] : sheetArg;
  if(!sheetId || !csvArg || !fs.existsSync(csvArg)){
    console.error('Usage: node push-to-sheet.js <sheet URL or ID> <csv path> [--tab ToSend]');
    process.exit(2);
  }
  const rows = parse(fs.readFileSync(csvArg,'utf8')).filter(r=>r.length>1);
  const header = rows[0], data = rows.slice(1);
  const tok = await getToken();
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;

  // header only once: if the tab's A1 is empty, prepend the header row
  const chk = await (await fetch(`${base}/values/${encodeURIComponent(tab)}!A1:A1`,{headers:{Authorization:'Bearer '+tok}})).json();
  if (chk.error){ console.error('READ ERROR:', JSON.stringify(chk.error)); process.exit(3); }
  const empty = !chk.values || !chk.values.length;
  const values = empty ? [header, ...data] : data;

  const wr = await fetch(`${base}/values/${encodeURIComponent(tab)}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,{
    method:'POST', headers:{Authorization:'Bearer '+tok,'Content-Type':'application/json'}, body:JSON.stringify({values})});
  const wres = await wr.json();
  if(wres.error){console.error('APPEND ERROR:',JSON.stringify(wres.error));process.exit(4)}
  console.log(`OK — appended ${data.length} rows to '${tab}'${empty?' (with header)':''}.`);
  console.log('URL: https://docs.google.com/spreadsheets/d/'+sheetId);
})();
