#!/usr/bin/env node
// Create/populate a Google Sheet in the shared folder via the service account.
// Auth: JWT (no external deps). Usage: node push-to-sheet.js
const fs = require('fs'), crypto = require('crypto'), path = require('path'), os = require('os');
const KEY = require(path.join(os.homedir(), '.credentials/outreach-sheets-sa.json'));
const FOLDER = '18HBCUZx3sqb7awGxuVQlhM53JNQowcKg';
const SRC = path.join(__dirname, 'exports/funded-startups-2026-04-checked.csv');
const TITLE = 'ToSend — LeadByte Funded';

function parse(t){const r=[];let row=[],f='',q=false;for(let i=0;i<t.length;i++){const c=t[i];if(q){if(c==='"'&&t[i+1]==='"'){f+='"';i++}else if(c==='"'){q=false}else f+=c}else{if(c==='"')q=true;else if(c===','){row.push(f);f=''}else if(c==='\n'){row.push(f);r.push(row);row=[];f=''}else if(c==='\r'){}else f+=c}}if(f.length||row.length){row.push(f);r.push(row)}return r}
const b64url = b => Buffer.from(b).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');

async function getToken(){
  const now = Math.floor(Date.now()/1000);
  const head = b64url(JSON.stringify({alg:'RS256',typ:'JWT'}));
  const claim = b64url(JSON.stringify({iss:KEY.client_email,scope:'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}));
  const unsigned = head+'.'+claim;
  const sig = b64url(crypto.createSign('RSA-SHA256').update(unsigned).sign(KEY.private_key));
  const r = await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:unsigned+'.'+sig})});
  const j = await r.json();
  if(!j.access_token){console.error('TOKEN ERROR:',JSON.stringify(j));process.exit(1)}
  return j.access_token;
}

(async () => {
  const tok = await getToken();
  const rows = parse(fs.readFileSync(SRC,'utf8')).filter(r=>r.length>1);
  const h=rows[0], d=rows.slice(1), ci=Object.fromEntries(h.map((x,i)=>[x,i]));
  const hot = d.filter(r=>r[ci.hot]==='1' && /@/.test(r[ci.email]||''));
  const header=['email','first_name','last_name','company','website','linkedin_url','bucket','ai_score','site_status','source','status'];
  const values=[header];
  for(const r of hot){const dm=(r[ci.dm]||'').trim().split(/\s+/);values.push([r[ci.email],dm[0]||'',dm.slice(1).join(' '),r[ci.name],r[ci.website],r[ci.li],r[ci.bucket],r[ci.aiScore],r[ci.siteStatus],'LeadByte 2026-04','unverified'])}

  const arg = process.argv[2] || '';
  const m = arg.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  const sheetId = m ? m[1] : arg;
  if(!sheetId){console.error('Usage: node push-to-sheet.js <sheet URL or ID>\n(Create an empty sheet in the folder first — the robot account cannot create files, only fill existing ones.)');process.exit(2)}
  const wr = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1?valueInputOption=RAW`,{method:'PUT',headers:{Authorization:'Bearer '+tok,'Content-Type':'application/json'},body:JSON.stringify({values})});
  const wres = await wr.json();
  if(wres.error){console.error('WRITE ERROR:',JSON.stringify(wres.error));process.exit(3)}
  console.log('OK — rows written:', values.length-1);
  console.log('URL: https://docs.google.com/spreadsheets/d/'+sheetId);
})();
