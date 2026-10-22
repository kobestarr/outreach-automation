// Model choice and request shaping for every Anthropic call in this repo.
// IDs, the temperature rejection and the thinking settings checked against
// https://platform.claude.com/docs/en/models/overview, .../models/sonnet-5-5/whats-new-sonnet-5-5 and
// .../models/haiku-5-5/migration-guide on 2026-10-22.

const DEFAULTS = {
  email: 'claude-sonnet-5-5',
  linkedin: 'claude-sonnet-5-5',
  mechanical: 'claude-haiku-5-5',
};

const ENV = {
  email: ['OUTREACH_EMAIL_MODEL', 'OUTREACH_COPY_MODEL'],
  linkedin: ['OUTREACH_LINKEDIN_MODEL', 'OUTREACH_COPY_MODEL'],
  mechanical: ['OUTREACH_MECHANICAL_MODEL'],
};

// explicit > per-site env > shared env > default
function resolveModel(role, explicit) {
  if (explicit) return explicit;
  for (const name of ENV[role] || []) {
    if (process.env[name]) return process.env[name];
  }
  const d = DEFAULTS[role];
  if (!d) throw new Error(`Unknown model role: ${role}`);
  return d;
}

const isGen5 = (model) => /^claude-(sonnet|haiku|opus|fable|mythos)-5/.test(model);
const HAIKU_5_MAX_TOKENS_FLOOR = 1024;

// 5.x models return 400 if temperature/top_p/top_k are sent. Adaptive thinking is on by default and its
// tokens count toward max_tokens, so switch it off (Sonnet 5.5 rejects "disabled", it needs between_tools)
// or set effort low (Haiku 5.5), and leave headroom on Haiku in case it still thinks.
function shapeBody(body) {
  const out = { ...body };
  if (!isGen5(out.model)) return out;
  delete out.temperature;
  delete out.top_p;
  delete out.top_k;
  if (out.model === 'claude-sonnet-5-5') out.thinking = { type: 'between_tools' };
  if (out.model === 'claude-haiku-5-5') {
    out.output_config = { effort: 'low' };
    out.max_tokens = Math.max(out.max_tokens || 0, HAIKU_5_MAX_TOKENS_FLOOR);
  }
  return out;
}

function extractText(content) {
  const block = (content || []).find((b) => b && b.type === 'text' && typeof b.text === 'string');
  return block ? block.text : '';
}

module.exports = { DEFAULTS, resolveModel, shapeBody, extractText, isGen5 };
