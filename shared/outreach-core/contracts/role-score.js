'use strict';
/** Fit score 1-10 for rows that arrive without one (Recon). Port of the job search classifier's scoring against Kobi's brief and CV. */
const KEYWORDS = [['marketing automation', 3], ['ai automation', 3], ['automation', 2], ['hubspot', 2], ['gohighlevel', 3], ['zapier', 2], ['n8n', 3], ['make.com', 2], ['claude', 2], ['ppc', 2], ['paid media', 2], ['paid search', 2], ['performance marketing', 2], ['seo', 2], ['crm', 1], ['podcast', 3], ['growth', 1], ['lifecycle', 1], ['marketing operations', 2], ['ai ', 1], ['google ads', 2], ['meta ads', 2], ['linkedin ads', 2], ['paid social', 2], ['paid advertising', 2]];

function scoreRole({ title = '', description = '' }) {
  const t = String(title).toLowerCase(), d = String(description).toLowerCase(), txt = t + ' ' + d;
  let s = 3;
  for (const [k, w] of KEYWORDS) { if (t.includes(k)) s += w; else if (d.includes(k)) s += 0.4 * w; }
  if (/(fully[- ]remote|100% ?remote)/.test(txt)) s += 1;
  if (/(day rate|£\d+.{0,12}(per day|\/ ?day|pd|p\/d))/.test(txt)) s += 0.5;
  if (/\bmanager\b/.test(t)) s -= 2;
  if (/(per annum|yearly|£\d\d,\d{3}|salary)/.test(txt) && !/(per day|\/ ?day|day rate|p\/d|\bpd\b)/.test(txt)) s -= 1.5;
  if (/(intern|junior|assistant|apprentice|graduate|trainee|coordinator)/.test(t)) s -= 3;
  if (/(designer|developer|engineer|data scientist|copywriter|writer|editor|video|animator|social media)/.test(t) && !/automation/.test(t)) s -= 1.5;
  return Math.max(1, Math.min(10, Math.round(s)));
}
module.exports = { scoreRole };
