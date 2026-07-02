// shared/outreach-core/campaigns/campaign-registry.js
// Registry: campaign key -> { sheetId, sheetUrl, label, carriers: {field: template} }
const fs = require('fs'), path = require('path');

function loadRegistry(file) {
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`Corrupt campaign registry at ${file}: ${e.message}. Fix the JSON by hand (it is committed to git, so 'git diff' shows what changed).`);
  }
}

function getCampaign(file, key) {
  return loadRegistry(file)[key] || null;
}

function saveCampaign(file, key, entry) {
  const reg = loadRegistry(file);
  reg[key] = entry;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(reg, null, 2) + '\n');
}

module.exports = { loadRegistry, getCampaign, saveCampaign };
