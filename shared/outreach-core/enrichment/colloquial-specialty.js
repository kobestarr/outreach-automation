// shared/outreach-core/enrichment/colloquial-specialty.js
// Clinical job title -> patient-language specialty phrase (plural), for the
// {{ColloquialSpecialtyPlural}} merge field ("...compared him to the other
// <phrase> on the list"). The phrase must be what a PATIENT would call the
// specialty on a referral list, never clinical taxonomy.
//
// Ordered table: most specific pattern first. Extend as new specialty lists
// arrive (Doctify etc.); resolveAll() surfaces unmapped titles loudly so a
// human (or an LLM pass + human review) fills the gaps BEFORE export.

const RULES = [
  // cardiology sub-specialties (LeadRocks 2024 list)
  { re: /electrophysiolog/i, phrase: 'heart rhythm specialists' },
  { re: /paediatric.*cardiolog|cardiolog.*paediatric/i, phrase: "children's heart specialists" },
  { re: /heart failure/i, phrase: 'heart failure specialists' },
  { re: /interventional cardiolog/i, phrase: 'heart specialists' },
  { re: /cardiothoracic|cardiac surg/i, phrase: 'heart surgeons' },
  { re: /cardiolog/i, phrase: 'cardiologists' },
  // common future specialties (patient phrasing, extend with each new list)
  { re: /orthopaedic.*(knee|hip)|(knee|hip).*surg/i, phrase: 'knee and hip surgeons' },
  { re: /orthopaedic/i, phrase: 'orthopaedic surgeons' },
  { re: /paediatric.*neurosurg|neurosurg.*paediatric/i, phrase: "children's brain surgeons" },
  { re: /neurosurg/i, phrase: 'brain and spine surgeons' },
  { re: /neurolog/i, phrase: 'neurologists' },
  { re: /gastroenterolog/i, phrase: 'gastroenterologists' },
  { re: /dermatolog/i, phrase: 'skin specialists' },
  { re: /ophthalmolog/i, phrase: 'eye surgeons' },
  { re: /obstetric|gynaecolog/i, phrase: 'gynaecologists' },
  { re: /urolog/i, phrase: 'urologists' },
  { re: /oncolog/i, phrase: 'cancer specialists' },
  { re: /radiolog/i, phrase: 'radiologists' },
  { re: /anaesthet/i, phrase: 'anaesthetists' },
  { re: /psychiatr/i, phrase: 'psychiatrists' },
  { re: /rheumatolog/i, phrase: 'rheumatologists' },
  { re: /endocrinolog/i, phrase: 'hormone specialists' },
  { re: /respiratory|pulmonolog/i, phrase: 'lung specialists' },
  { re: /nephrolog|renal/i, phrase: 'kidney specialists' },
  { re: /plastic.*surg/i, phrase: 'plastic surgeons' },
  { re: /osteopath/i, phrase: 'osteopaths' },
  { re: /physiotherap/i, phrase: 'physiotherapists' },
];

// Title -> phrase, or null when no rule matches (caller decides the fallback).
function colloquialSpecialtyPlural(jobTitle) {
  if (!jobTitle || typeof jobTitle !== 'string') return null;
  for (const { re, phrase } of RULES) if (re.test(jobTitle)) return phrase;
  return null;
}

// Map many titles; returns { byTitle, unmapped } so gaps are loud, not silent.
function resolveAll(titles, { fallback = null } = {}) {
  const byTitle = {};
  const unmapped = [];
  for (const t of new Set(titles.filter(Boolean))) {
    const phrase = colloquialSpecialtyPlural(t);
    if (phrase) byTitle[t] = phrase;
    else { unmapped.push(t); if (fallback) byTitle[t] = fallback; }
  }
  return { byTitle, unmapped };
}

module.exports = { colloquialSpecialtyPlural, resolveAll, RULES };
