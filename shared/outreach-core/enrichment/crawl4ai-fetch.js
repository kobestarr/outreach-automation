// shared/outreach-core/enrichment/crawl4ai-fetch.js
// Robust website text via the crawl4ai `crwl` CLI (renders JS, defeats most bot-blocks, returns
// clean markdown). Replaces the simple fetchWebsiteText which fails on JS/blocked sites.
// crawl4ai is installed system-wide (/opt/homebrew/bin/crwl, python3.13). Node shells out to it.
const { spawn } = require('child_process');

// crawlText(url, timeoutMs) -> clean markdown string, or null on any failure. Never throws.
function crawlText(url, timeoutMs = 60000) {
  return new Promise(resolve => {
    let out = '', err = '', done = false;
    const finish = v => { if (!done) { done = true; try { child.kill('SIGKILL'); } catch {} resolve(v); } };
    const child = spawn('crwl', ['crawl', url, '-o', 'markdown'], {
      env: { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH || ''}` },
    });
    const timer = setTimeout(() => finish(null), timeoutMs);
    child.stdout.on('data', d => { out += d; if (out.length > 2_000_000) finish(clean(out)); });
    child.stderr.on('data', d => { err += d; });
    child.on('error', () => { clearTimeout(timer); finish(null); });
    child.on('close', () => {
      clearTimeout(timer);
      const text = clean(out);
      finish(text && text.length > 50 ? text : null);
    });
  });
}

// The CLI may emit JSON ({markdown,html,...}) or raw markdown depending on version; handle both.
function clean(raw) {
  if (!raw) return null;
  const s = raw.trim();
  if (s.startsWith('{')) {
    try { const j = JSON.parse(s); return (j.markdown || j.text || j.cleaned_html || '').trim() || null; } catch { /* fall through */ }
  }
  return s;
}

module.exports = { crawlText };
