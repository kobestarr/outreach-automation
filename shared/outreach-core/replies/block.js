/**
 * Block an address everywhere, the Kobi standard (18 Oct 2026): Mailead blocklist, the email finder's
 * suppress list, data/do-not-contact.txt and data/sent-ledger.txt. Only for firm nos and people who left.
 * Every dependency is injected so tests touch nothing real. Each target is tried even if another fails;
 * re-running is safe (the files never get duplicate lines, and Mailead/finder blocks are idempotent).
 */
const { isOurMailbox } = require('./mailboxes');

const BLOCKABLE = ['no', 'left_company'];
const EMAIL = /^[^\s@,<>]+@[^\s@,<>]+\.[A-Za-z]{2,}$/;
const NEVER = ['kobi@kobestarr.io'];

const firstCols = text => new Set(String(text).split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t')[0].trim().toLowerCase()));

function appendUnique(email, line, path, { readFile, appendFile }) {
  let text = '';
  try { text = readFile(path); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (firstCols(text).has(email)) return 'exists';
  appendFile(path, `${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`);
  return 'added';
}

async function blockEverywhere(rawEmail, reason, deps) {
  const { maileadReq, finderSuppress, label, now = () => new Date(), source = 'reply-engine' } = deps;
  if (!BLOCKABLE.includes(label)) throw new Error(`blockEverywhere refuses label "${label}" (only ${BLOCKABLE.join(', ')})`);
  const email = String(rawEmail || '').trim().toLowerCase();
  if (!EMAIL.test(email) || isOurMailbox(email) || NEVER.includes(email)) throw new Error(`blockEverywhere refuses address "${rawEmail}"`);

  const date = now().toISOString().slice(0, 10);
  const out = {};
  const attempt = async (key, fn) => { try { out[key] = await fn(); } catch (e) { out[key] = `failed: ${e.message}`; } };

  await attempt('mailead', async () => {
    const r = await maileadReq('update_blacklist', { body: { email_to_block: email } });
    if (!(r && r.json && r.json.success === true)) throw new Error(`Mailead said ${JSON.stringify(r && r.json).slice(0, 120)}`);
    return 'ok';
  });
  await attempt('finder', async () => { await finderSuppress(email, reason); return 'ok'; });
  await attempt('dnc', async () => appendUnique(email, `${email}\t${reason} (${date}, ${source})`, deps.dncPath, deps));
  await attempt('ledger', async () => appendUnique(email, email, deps.ledgerPath, deps));

  out.complete = ['mailead', 'finder'].every(k => out[k] === 'ok') && ['dnc', 'ledger'].every(k => out[k] === 'added' || out[k] === 'exists');
  out.email = email;
  return out;
}

// launchd has a thin PATH, so the finder is called by absolute path.
// execFile is async (cmd, args) => ... ; real wiring uses util.promisify(child_process.execFile)
const FINDER_BIN = require('path').join(require('os').homedir(), '.local', 'bin', 'email-finder');
function makeFinderSuppress(execFile, bin = FINDER_BIN) {
  return (email, reason) => execFile(bin, ['suppress', email, reason]);
}

module.exports = { blockEverywhere, makeFinderSuppress, BLOCKABLE, FINDER_BIN };
