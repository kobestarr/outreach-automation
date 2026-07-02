// shared/outreach-core/content-generation/insight-composer.js
// Deterministic carrier-field insight composition. No LLM. No em dashes, ever.
// Placeholders: {category} (lowercased), {town}, {company_name}, {first_name}, {signal}...
// any canonical lead field is legal; unresolved placeholders are an error, not a blank.

function fillTemplate(tpl, lead) {
  const out = tpl.replace(/\{(\w+)\}/g, (_, field) => {
    let v = lead[field];
    v = v === undefined || v === null ? '' : String(v).trim();
    if (v === '') throw new Error(`unresolved placeholder {${field}} for ${lead.email || lead.company_name || 'lead'}`);
    if (field === 'category') v = v.toLowerCase();
    return v;
  });
  if (/—|–/.test(out)) throw new Error('em dash (or en dash) in composed insight: ' + out);
  return out;
}

// carriers: { <mailead_field>: <template> } -> { <mailead_field>: <composed text> }
function composeInsights(lead, carriers) {
  const out = {};
  for (const [field, tpl] of Object.entries(carriers || {})) out[field] = fillTemplate(tpl, lead);
  return out;
}

module.exports = { composeInsights, fillTemplate };
