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

// Models that reject non-default temperature, top_p and top_k (thinking docs, "Sampling parameters", 2026-10-22).
const isGen5 = (model) => /^claude-(sonnet|haiku|opus|fable|mythos)-5/.test(model)
  || /^claude-(opus-4-7|opus-4-8|mythos-preview)/.test(model);
const NO_THINKING_OFF_HEADROOM = 4096;
// The bare id, or the id with a date or -latest suffix; never a different release (Opus 5 is not Opus 5.5).
const is = (model, id) => model === id || new RegExp(`^${id}(-\\d{8}|-latest)$`).test(model);

// Thinking is turned off wherever the live thinking docs allow it:
//   Sonnet 5.5: "disabled" is a 400, the lowest setting is between_tools
//   Haiku 5.5, Sonnet 5, Opus 5: "disabled" is accepted (Haiku 5.5 and Opus 5 at effort high or below)
// Opus 5.5, Fable and Mythos cannot turn thinking off, so they get max_tokens headroom and callAnthropic's
// stop_reason check catches any truncation. Opus 4.7 and 4.8 already run with thinking off.
function shapeBody(body) {
  const out = { ...body };
  if (!isGen5(out.model)) return out;
  delete out.temperature;
  delete out.top_p;
  delete out.top_k;
  const m = out.model;
  if (is(m, 'claude-sonnet-5-5')) {
    out.thinking = { type: 'between_tools' };
  } else if (is(m, 'claude-haiku-5-5')) {
    out.thinking = { type: 'disabled' };
    out.output_config = { effort: 'low' };
  } else if (is(m, 'claude-sonnet-5') || is(m, 'claude-opus-5')) {
    out.thinking = { type: 'disabled' };
  } else if (/^claude-(opus-4-7|opus-4-8)/.test(m)) {
    // thinking is already off by default
  } else {
    out.max_tokens = Math.max(out.max_tokens || 0, NO_THINKING_OFF_HEADROOM);
  }
  return out;
}

// The house rule is no em or en dashes in anything that goes out. A spaced dash between words becomes " - ",
// a joined one (9-5, Hall-Wood) a plain hyphen, and a dash at the edge of a line (a signature) keeps its line.
function stripDashes(text) {
  const str = String(text);
  return str.replace(/[ \t]*[\u2014\u2013][ \t]*/g, (m, off) => {
    const before = str[off - 1];
    const after = str[off + m.length];
    const atEdge = off === 0 || before === '\n' || after === '\n' || after === undefined;
    if (atEdge) return m.replace(/[\u2014\u2013]/, '-');
    return /\s/.test(m) ? ' - ' : '-';
  });
}

function extractText(content) {
  const block = (content || []).find((b) => b && b.type === 'text' && typeof b.text === 'string');
  return block ? block.text : '';
}

module.exports = { DEFAULTS, resolveModel, shapeBody, extractText, stripDashes, isGen5 };
