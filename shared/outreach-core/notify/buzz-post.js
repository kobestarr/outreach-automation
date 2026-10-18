/** Post to Buzz ~outreach via the local buzz CLI (same mechanism as mailead-alerts-buzz.js). */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CHANNEL = '22517fe0-56ff-48d6-96a6-e2c668032c6f'; // Buzz ~outreach
const BUZZ = path.join(os.homedir(), '.local', 'bin', 'buzz');

function buzzEnv() {
  const env = { ...process.env };
  const file = path.join(os.homedir(), '.buzz', '.secrets', 'buzz.env');
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

async function post(content) {
  execFileSync(BUZZ, ['messages', 'send', '--channel', CHANNEL, '--content', '-'], { input: content, env: buzzEnv(), stdio: ['pipe', 'ignore', 'inherit'] });
}

module.exports = { post, CHANNEL };
