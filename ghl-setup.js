#!/usr/bin/env node
/**
 * ghl-setup.js: check or create the "Cold Email" pipeline in each brand's GHL sub-account.
 *
 *   node ghl-setup.js --check            read only: is the pipeline there with the right stages?
 *   node ghl-setup.js --plan             print exactly what --apply would create (read only)
 *   node ghl-setup.js --apply            create missing pipelines (writes to GHL)
 *   add --no-cli to bypass the LeadGen Jay CLI and use direct API calls only
 *   add --brand kobestarr|stripped|dealflow to limit to one sub-account
 *
 * Never edits or deletes an existing pipeline. Tokens are never printed.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const { execFile } = require('child_process');
const { createGhlTracker, loadGhlCreds, STAGES, BRANDS, PIPELINE_NAME, DEFAULT_LOCATIONS } = require('./shared/outreach-core/crm/ghl-tracker');

const MESSAGES = {
  ok: 'OK, Cold Email pipeline present with the right stages',
  created: 'CREATED and verified',
  would_create: `MISSING, would create "${PIPELINE_NAME}" with: ${STAGES.join(' > ')}`,
  mismatch: 'EXISTS BUT WRONG',
  no_credentials: 'NO CREDENTIALS found (vault ghl.<brand> or ~/.claude.json)',
  error: 'ERROR',
};

const CLI_DIR = process.env.GHL_CLI_DIR || path.join(os.homedir(), 'Development', 'One Hour Vibe Coder', 'gohighlevel-cli');

async function main(argv, { fetch, creds, cli, out = console.log } = {}) {
  const has = (f) => argv.includes(f);
  const bi = argv.indexOf('--brand');
  const brands = bi >= 0 ? [argv[bi + 1]] : BRANDS;
  if (brands.some((b) => !BRANDS.includes(b))) { out(`Unknown brand. Use one of: ${BRANDS.join(', ')}`); return 2; }
  const modes = ['--check', '--plan', '--apply'].filter(has);
  if (modes.length !== 1) { out('Usage: node ghl-setup.js --check | --plan | --apply [--brand kobestarr|stripped|dealflow]'); return 2; }
  const apply = modes[0] === '--apply';
  // Kobi's preferred route: the GHL CLI (ghlp <profile>), raw API only for what it cannot do
  if (cli === undefined && !has('--no-cli') && fs.existsSync(path.join(CLI_DIR, 'ghlp'))) {
    cli = { exec: promisify(execFile), ghlp: path.join(CLI_DIR, 'ghlp') };
  }
  const tracker = createGhlTracker({ fetch, creds: creds || loadGhlCreds({ cliDir: CLI_DIR }), cli: cli || undefined, log: () => {} });
  const results = await tracker.ensurePipelines({ dryRun: !apply, brands });
  let bad = 0;
  for (const r of results) {
    out(`${r.brand.padEnd(10)} (${DEFAULT_LOCATIONS[r.brand]}): ${MESSAGES[r.status]}${r.detail ? ' (' + r.detail + ')' : ''}`);
    if (modes[0] === '--plan' && r.status === 'would_create') {
      r.stages.forEach((s, i) => out(`    ${i + 1}. ${s}`));
    }
    if (['mismatch', 'error', 'no_credentials'].includes(r.status)) bad++;
  }
  if (modes[0] === '--plan') out('\nPlan only. Nothing was written. To create: node ghl-setup.js --apply');
  return bad ? 1 : 0;
}

module.exports = { main };
if (require.main === module) main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e.message); process.exit(1); });
