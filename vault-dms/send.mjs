// Vault DMs: thank past Newbies registrants and point them at the Vault, via Prosp, at a slow human pace.
// Usage: node send.mjs [--dry] [--max N]        (run daily; it works out today's quota and the time left)
// Rules: Mon to Fri, 09:30 to 17:00 UK, random gaps, quota ramps 10/12/18/24/30 then 30 a day.
// Stops at the first failure or any auth/limit wording (LinkedIn warning, 15 Oct 2026) and alerts Buzz.
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const D = fileURLToPath(new URL('.', import.meta.url));
const keys = JSON.parse(fs.readFileSync(os.homedir() + '/.credentials/api-keys.json', 'utf8'));
const API = keys.prosp.apiKey;
const SENDER = 'https://www.linkedin.com/in/kobiomenaka/';
const DRY = process.argv.includes('--dry');
const maxArg = process.argv.indexOf('--max'); const MAX = maxArg > -1 ? +process.argv[maxArg + 1] : Infinity;
const QUOTA = { '2026-10-22': 10, '2026-10-23': 12, '2026-10-26': 18, '2026-10-27': 24, '2026-10-28': 30 };
const DEFAULT_QUOTA = 30;
const START = '09:30', END = '17:00';
const LINK = 'https://kobestarr.io/vault-dm';
const text = (first) => [
  `Hi ${first}, thanks for signing up to my LinkedIn Live series "Claude Code for Intelligent Newbies". I've put all six decks in one place on my brand new Substack dedicated to Claude Code Coaching.`,
  '',
  `They are all free: ${LINK}`,
  '',
  "I'd love to know if you have any outstanding questions, because I want to do more of these series and really answer the real questions that people have.",
].join('\n');
const uk = () => { const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false }); const p = Object.fromEntries(f.formatToParts(new Date()).map(x => [x.type, x.value])); return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}`, wd: p.weekday, mins: (+p.hour) * 60 + (+p.minute) }; };
const toMins = (hm) => (+hm.slice(0, 2)) * 60 + (+hm.slice(3));
const slug = (u) => ((String(u || '').match(/\/in\/([^/?#]+)/) || [])[1] || '').toLowerCase();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const SENT_PATH = D + 'sent.json';
const sent = fs.existsSync(SENT_PATH) ? JSON.parse(fs.readFileSync(SENT_PATH, 'utf8')) : {};
const log = (m) => { const line = `${new Date().toISOString()} ${m}`; console.log(line); fs.appendFileSync(D + 'send.log', line + '\n'); };
const alert = (m) => { try { execFileSync('/usr/local/bin/node', ['mailead-alerts-buzz.js', '--post', `Vault DMs: ${m}`], { cwd: D + '..', timeout: 30000, env: { ...process.env, PATH: '/usr/local/bin:/opt/homebrew/bin:' + process.env.PATH } }); } catch (e) { log('buzz alert failed: ' + String(e.message).slice(0, 80)); } };
const post = async (path, body) => { const res = await fetch('https://prosp.ai/api/v1' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: API, ...body }) }); let json = null; try { json = await res.json(); } catch {} return { status: res.status, json }; };

const now = uk();
if (['Sat', 'Sun'].includes(now.wd)) { log(`weekend (${now.wd}), nothing to do`); process.exit(0); }
const quota = QUOTA[now.date] ?? DEFAULT_QUOTA;
const sentToday = Object.values(sent).filter(s => s.ukDate === now.date).length;
let remaining = Math.min(quota - sentToday, MAX);
const recipients = JSON.parse(fs.readFileSync(D + 'recipients.json', 'utf8'));
const queue = recipients.filter(p => !sent[slug(p.url)]).slice(0, Math.max(0, remaining));
log(`${DRY ? 'DRY RUN. ' : ''}${now.wd} ${now.date} ${now.hm} UK: quota ${quota}, already sent today ${sentToday}, queue ${queue.length}, never-messaged left ${recipients.filter(p => !sent[slug(p.url)]).length}`);
if (DRY) { queue.slice(0, 3).forEach(p => console.log(`\n--- ${p.name} (${p.n} weeks)\n${text(p.first)}`)); process.exit(0); }
for (const [i, p] of queue.entries()) {
  const t = uk();
  if (t.mins >= toMins(END) - 2) { log('reached 17:00 UK window end, stopping for today'); break; }
  if (t.mins < toMins(START)) { const w = (toMins(START) - t.mins) * 60000; log(`before ${START}, waiting ${Math.round(w / 60000)} min`); await sleep(w); }
  const r = await post('/leads/send-message', { linkedin_url: p.url, sender: SENDER, message: text(p.first) });
  const body = JSON.stringify(r.json || {});
  const good = r.status === 200 && r.json && !/error|expired|invalid|limit|restrict|captcha|checkpoint/i.test(body);
  if (!good) { log(`FAILED ${p.name}: ${r.status} ${body.slice(0, 220)}. STOPPING.`); alert(`stopped after a failure on ${p.name} (${r.status}). Check Prosp and LinkedIn before restarting.`); process.exit(1); }
  sent[slug(p.url)] = { name: p.name, at: new Date().toISOString(), ukDate: uk().date, n: p.n, response: r.json };
  fs.writeFileSync(SENT_PATH, JSON.stringify(sent, null, 1));
  log(`sent ${i + 1}/${queue.length}: ${p.name} (${p.n} weeks). response ${body.slice(0, 120)}`);
  if (i < queue.length - 1) {
    const left = (toMins(END) - 3 - uk().mins) * 60000, per = left / (queue.length - 1 - i);
    const wait = Math.max(3 * 60000, Math.round(per * (0.7 + Math.random() * 0.6)));
    log(`next in ${Math.round(wait / 60000)} min`); await sleep(wait);
  }
}
log(`done for today. total ever sent ${Object.keys(sent).length}`);
