// shared/outreach-core/campaigns/sheet-rows.js
// Two-block sheet layout. snake_case = reference block (Kobi's source of truth,
// never mapped). Title Case = Mailead block (the ONLY columns TaskMagic maps).
const REF_FIELDS = ['first_name', 'last_name', 'email', 'company_name', 'category', 'town', 'website', 'linkedin_url'];
const REOON_FIELDS = ['reoonStatus', 'reoonScore', 'reoonSafe'];
// canonical field -> Mailead field label
const MAILEAD_LABELS = { first_name: 'First Name', last_name: 'Last Name', email: 'Email', company_name: 'Company Name', linkedin_url: 'Linkedin Url' };
const BASE_MAILEAD = ['first_name', 'last_name', 'email', 'company_name'];

const RESERVED = new Set([...REF_FIELDS, ...REOON_FIELDS, ...Object.values(MAILEAD_LABELS)]);
const refColumnName = name => (RESERVED.has(name) ? 'ref_' + name : name);
const LABEL_TO_FIELD = Object.fromEntries(Object.entries(MAILEAD_LABELS).map(([f, l]) => [l, f]));

function buildHeader(extraRefCols, carrierFields) {
  const maileadFields = [...BASE_MAILEAD];
  for (const c of carrierFields) if (!maileadFields.includes(c)) maileadFields.push(c);
  return [
    ...REF_FIELDS, ...REOON_FIELDS, ...extraRefCols.map(refColumnName),
    ...maileadFields.map(f => {
      if (!MAILEAD_LABELS[f]) throw new Error(`no Mailead label for carrier field '${f}'`);
      return MAILEAD_LABELS[f];
    }),
  ];
}

function buildRow(lead, header, insights) {
  return header.map(col => {
    if (LABEL_TO_FIELD[col]) { // Mailead block: injected insight wins, else real value
      const f = LABEL_TO_FIELD[col];
      return insights[f] !== undefined ? insights[f] : (lead[f] || '');
    }
    if (REF_FIELDS.includes(col) || REOON_FIELDS.includes(col)) return lead[col] || '';
    const refKey = col.startsWith('ref_') && !(lead.ref && col in lead.ref) ? col.slice(4) : col;
    return (lead.ref && lead.ref[refKey]) || '';
  });
}

module.exports = { buildHeader, buildRow, MAILEAD_LABELS };
