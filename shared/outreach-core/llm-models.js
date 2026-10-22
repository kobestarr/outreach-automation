// Model choice and request shaping for every Anthropic call in this repo.
// IDs, the temperature rejection and the thinking settings checked against
// https://platform.claude.com/docs/en/models/overview, .../models/sonnet-5-5/whats-new-sonnet-5-5 and
// .../models/haiku-5-5/migration-guide on 2026-10-22 (thinking table re-read for this change).

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
const NO_THINKING_OFF_HEADROOM = 4096;

// 5.x models return 400 if temperature/top_p/top_k are sent. Adaptive thinking is on by default and its
// tokens count toward max_tokens, so thinking is turned off wherever the live thinking docs allow it:
//   Sonnet 5.5: "disabled" is a 400, the lowest setting is between_tools
//   Haiku 5.5, Sonnet 5, Opus 5: "disabled" is accepted (Haiku 5.5 and Opus 5 at effort high or below)
// Opus 5.5, Fable and Mythos cannot turn thinking off, so they get max_tokens headroom and callAnthropic's
// stop_reason check catches any truncation.
function shapeBody(body) {
  const out = { ...body };
  if (!isGen5(out.model)) return out;
  delete out.temperature;
  delete out.top_p;
  delete out.top_k;
  if (out.model === 'claude-sonnet-5-5') {
    out.thinking = { type: 'between_tools' };
  } else if (out.model === 'claude-haiku-5-5') {
    out.thinking = { type: 'disabled' };
    out.output_config = { effort: 'low' };
  } else if (/^claude-(sonnet-5|opus-5)$/.test(out.model)) {
    out.thinking = { type: 'disabled' };
  } else {
    out.max_tokens = Math.max(out.max_tokens || 0, NO_THINKING_OFF_HEADROOM);
  }
  return out;
}

// The house rule is no em or en dashes in anything that goes out.
function stripDashes(text) {
  return String(text).replace(/\s*[\u2014\u2013]\s*/g, ' - ');
}

function extractText(content) {
  const block = (content || []).find((b) => b && b.type === 'text' && typeof b.text === 'string');
  return block ? block.text : '';
}

module.exports = { DEFAULTS, resolveModel, shapeBody, extractText, stripDashes, isGen5 };
