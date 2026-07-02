// shared/outreach-core/campaigns/sheet-rows.js
// Two-block sheet layout. snake_case = reference block (Kobi's source of truth,
// never mapped). Title Case = Mailead block (the ONLY columns TaskMagic maps).
const REF_FIELDS = ['first_name', 'last_name', 'email', 'company_name', 'category', 'town', 'website', 'linkedin_url'];
const REOON_FIELDS = ['reoonStatus', 'reoonScore', 'reoonSafe'];
// canonical field -> Mailead field label
const MAILEAD_LABELS = { first_name: 'First Name', last_name: 'Last Name', email: 'Email', company_name: 'Company Name', linkedin_url: 'Linkedin Url', phone: 'Phone' };
const BASE_MAILEAD = ['first_name', 'last_name', 'email', 'company_name'];

function buildHeader(extraRefCols, carrierFields) {
  const maileadFields = [...BASE_MAILEAD];
  for (const c of carrierFields) if (!maileadFields.includes(c)) maileadFields.push(c);
  return [
    ...REF_FIELDS, ...REOON_FIELDS, ...extraRefCols,
    ...maileadFields.map(f => {
      if (!MAILEAD_LABELS[f]) throw new Error(`no Mailead label for carrier field '${f}'`);
      return MAILEAD_LABELS[f];
    }),
  ];
}

function buildRow(lead, header, insights) {
  const labelToField = Object.fromEntries(Object.entries(MAILEAD_LABELS).map(([f, l]) => [l, f]));
  return header.map(col => {
    if (labelToField[col]) { // Mailead block: injected insight wins, else real value
      const f = labelToField[col];
      return insights[f] !== undefined ? insights[f] : (lead[f] || '');
    }
    if (REF_FIELDS.includes(col) || REOON_FIELDS.includes(col)) return lead[col] || '';
    return (lead.ref && lead.ref[col]) || '';
  });
}

module.exports = { buildHeader, buildRow, MAILEAD_LABELS };
