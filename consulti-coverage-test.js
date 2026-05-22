#!/usr/bin/env node
/**
 * Consulti coverage test — 5 veins, real DB targets.
 * Burns ~5 verify + ~6 lead credits maximum.
 */
const KEY = process.env.CONSULTI_API_KEY;
if (!KEY) { console.error("CONSULTI_API_KEY not set"); process.exit(1); }

const BASE = "https://www.consulti.ai/api/v1";
const H = { "Authorization": `Bearer ${KEY}`, "Content-Type": "application/json" };

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function post(path, body) {
  try {
    const r = await fetch(`${BASE}${path}`, { method: "POST", headers: H, body: JSON.stringify(body) });
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
    return { status: r.status, body: json };
  } catch (e) { return { status: 0, body: { error: e.message } }; }
}

async function get(path) {
  const r = await fetch(`${BASE}${path}`, { headers: H });
  return r.json();
}

function domainOf(url) {
  if (!url) return null;
  try {
    const u = url.includes("://") ? new URL(url) : new URL(`http://${url}`);
    let host = u.hostname.toLowerCase().replace(/^www\./, "");
    const social = ["facebook.com", "instagram.com", "google.com", "linkedin.com", "x.com", "twitter.com", "m.facebook.com"];
    if (social.some(s => host.includes(s))) return null;
    return host;
  } catch { return null; }
}

function summarise(label, res) {
  const { status, body } = res;
  if (status !== 200) {
    console.log(`  → HTTP ${status}: ${JSON.stringify(body).slice(0, 200)}`);
    return;
  }
  if (!body.success) {
    console.log(`  → FAIL: ${JSON.stringify(body).slice(0, 200)}`);
    return;
  }
  const d = body.data || {};
  if ("status" in d && "is_deliverable" in d) {
    console.log(`  → verify: status=${d.status} deliverable=${d.is_deliverable} catch_all=${d.is_catch_all} role=${d.is_role_account} cached=${d.cached} cost=${body.credits_used ?? d.credits_used}`);
  } else if (Object.keys(d).length === 0) {
    console.log(`  → NO MATCH (free) | cost=${body.credits_used ?? 0}`);
  } else {
    console.log(`  → MATCH: ${d.first_name} ${d.last_name} | ${d.job_title} @ ${d.company_name} | ${d.email} (${d.email_status}) | ${d.linkedin_url || '-'} | ${d.city || '-'}, ${d.country || '-'} | emp=${d.employee_count || '-'} | cost=${body.credits_used}`);
  }
}

(async () => {
  console.log("=".repeat(80));
  console.log("CREDITS BEFORE");
  console.log((await get("/credits")).data);
  console.log("=".repeat(80));

  // Test 1 — verify two known emails (info@ role + named alias)
  console.log("\n[TEST 1] /verify on existing KSD emails (does Consulti agree with our pipeline?)");
  for (const [label, email] of [
    ["Fiona Walker (info@ role)", "info@fionawalkerphotography.co.uk"],
    ["Mounting Stone (andrew@ named)", "andrew@themountingstone.co.uk"],
  ]) {
    console.log(` - ${label}: ${email}`);
    summarise(label, await post("/verify", { email }));
    await sleep(1500);
  }

  // Test 2 — find-by-name with no real domain (social-only "website")
  console.log("\n[TEST 2] /leads/find-by-name on UFH clubs with no real domain");
  for (const [club, raw] of [
    ["Osterley Rangers", "https://www.instagram.com/osterley.rangers/"],
    ["Hindsford AFC", "https://m.facebook.com/hindsford.tonics.7"],
  ]) {
    const d = domainOf(raw);
    console.log(` - ${club} (site=${raw}) → domain=${d}`);
    if (!d) { console.log("  → SKIPPED (no real domain — Consulti can't help)"); continue; }
    summarise(club, await post("/leads/find-by-name", { first_name: club.split(" ")[0], last_name: "Secretary", domain: d }));
    await sleep(1500);
  }

  // Test 3 — enrich on UK journalists (do they have media-people data?)
  console.log("\n[TEST 3] /leads/enrich on UFH journalists (UK media coverage check)");
  for (const [name, email] of [
    ["Andy Schooler", "andy@andyschoolermedia.com"],
    ["Helen Clarke", "helen.clarke@spektrix.com"],
  ]) {
    console.log(` - ${name}: ${email}`);
    summarise(name, await post("/leads/enrich", { email }));
    await sleep(1500);
  }

  // Test 4 — find-by-name on KSD owners w/ name+domain, no email (gap-fill)
  console.log("\n[TEST 4] /leads/find-by-name on KSD owners w/ name+domain, no email");
  for (const [first, last, site, biz] of [
    ["Paul", "Bygraves", "http://www.wearesapphire.co.uk/", "Sapphire (accountant)"],
    ["Derek", "Chadderton", "http://derekchadderton.co.uk/", "Actree Accountancy"],
  ]) {
    const d = domainOf(site);
    console.log(` - ${biz}: ${first} ${last} @ ${d}`);
    summarise(biz, await post("/leads/find-by-name", { first_name: first, last_name: last, domain: d }));
    await sleep(1500);
  }

  // Test 5 — verify on suspicious scraped rows
  console.log("\n[TEST 5] /verify on suspicious scraped rows (data hygiene)");
  for (const [label, email] of [
    ["Happycups sales@", "sales@happycups.co.uk"],
    ["Let Loose info@", "info@letlooseplay.co.uk"],
  ]) {
    console.log(` - ${label}: ${email}`);
    summarise(label, await post("/verify", { email }));
    await sleep(1500);
  }

  console.log("\n" + "=".repeat(80));
  console.log("CREDITS AFTER");
  console.log((await get("/credits")).data);
  console.log("=".repeat(80));
})();
