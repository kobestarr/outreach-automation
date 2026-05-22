/**
 * Consulti AI Email Verification + Lead Lookup
 *
 * Endpoints:
 *   /verify                    → 1 verify credit (0 on cache hit, HTTP 500, or invalid)
 *   /leads/find-by-name        → 1 lead credit (0 on no-match)
 *   /leads/find-by-linkedin    → 1 lead credit (0 on no-match)
 *   /leads/enrich              → 1 lead credit (0 on no-match)
 *
 * Cache: server-side 6-month. Re-verifying same email returns cached:true at 0 credits.
 * Base URL must use `www.` prefix — bare `consulti.ai` 307-redirects.
 *
 * Key lookup order:
 *   1. ~/.credentials/api-keys.json (consulti.apiKey)
 *   2. process.env.CONSULTI_API_KEY
 *   3. ../../kobestarr-tools/.env (CONSULTI_API_KEY=...)
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const BASE = "https://www.consulti.ai/api/v1";

let CACHED_KEY = null;

function getKey() {
  if (CACHED_KEY) return CACHED_KEY;

  // 1. ~/.credentials/api-keys.json
  try {
    const p = path.join(os.homedir(), ".credentials", "api-keys.json");
    if (fs.existsSync(p)) {
      const j = JSON.parse(fs.readFileSync(p, "utf8"));
      if (j.consulti?.apiKey) return (CACHED_KEY = j.consulti.apiKey);
    }
  } catch {}

  // 2. env var
  if (process.env.CONSULTI_API_KEY) return (CACHED_KEY = process.env.CONSULTI_API_KEY);

  // 3. kobestarr-tools/.env (sibling repo)
  const candidates = [
    "/Users/kobestarr/Development/One Hour Vibe Coder/kobestarr-tools/.env",
    path.join(os.homedir(), "Development", "One Hour Vibe Coder", "kobestarr-tools", ".env"),
  ];
  for (const f of candidates) {
    try {
      if (fs.existsSync(f)) {
        const m = fs.readFileSync(f, "utf8").match(/^CONSULTI_API_KEY=(.+)$/m);
        if (m) return (CACHED_KEY = m[1].trim().replace(/^['"]|['"]$/g, ""));
      }
    } catch {}
  }

  throw new Error("Consulti API key not found in ~/.credentials/api-keys.json, env, or kobestarr-tools/.env");
}

async function request(method, pathSuffix, body = null) {
  const opts = {
    method,
    headers: { Authorization: `Bearer ${getKey()}`, "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${pathSuffix}`, opts);
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text, _parseFailed: true }; }
  return { status: r.status, body: json };
}

/**
 * Check credit balance — free, no spend.
 */
async function getCredits() {
  const { status, body } = await request("GET", "/credits");
  if (status !== 200 || !body.success) throw new Error(`Consulti /credits failed: HTTP ${status} ${JSON.stringify(body).slice(0, 200)}`);
  return body.data;
}

/**
 * Verify one email.
 * Returns: { email, status, isDeliverable, isCatchAll, isRoleAccount, isDisposable, cached, creditsUsed, raw, error? }
 *
 * Status values: 'good' | 'risky' | 'bad' | 'unknown' | 'error'
 * Costs 1 verify credit unless cached (free), HTTP 500 (free), or 400 (free).
 *
 * Retry policy: up to 2 retries on HTTP 500 (backoff 2s, 4s).
 */
async function verifyEmail(email, { retries = 2 } = {}) {
  if (!email || !/.+@.+\..+/.test(email)) {
    return { email, status: "error", error: "invalid_format", isDeliverable: false, creditsUsed: 0 };
  }

  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res;
    try {
      res = await request("POST", "/verify", { email });
    } catch (e) {
      lastErr = e.message;
      if (attempt < retries) { await sleep(2000 * (attempt + 1)); continue; }
      return { email, status: "error", error: `network: ${lastErr}`, isDeliverable: false, creditsUsed: 0 };
    }

    const { status, body } = res;

    if (status === 200 && body.success) {
      const d = body.data || {};
      return {
        email,
        status: d.status || "unknown",
        isDeliverable: !!d.is_deliverable,
        isCatchAll: !!d.is_catch_all,
        isRoleAccount: !!d.is_role_account,
        isDisposable: !!d.is_disposable,
        cached: !!d.cached,
        creditsUsed: body.credits_used ?? d.credits_used ?? 1,
        verifiedAt: new Date().toISOString(),
        raw: d,
      };
    }

    if (status === 404) {
      return { email, status: "unknown", isDeliverable: false, error: "not_found", creditsUsed: 0 };
    }

    if (status === 400) {
      return { email, status: "error", error: `bad_request: ${(body.error || JSON.stringify(body)).slice(0, 200)}`, isDeliverable: false, creditsUsed: 0 };
    }

    if (status === 402) {
      throw new Error("Consulti: insufficient verify credits");
    }

    if (status === 401) {
      throw new Error("Consulti: invalid API key (401)");
    }

    if (status === 500) {
      lastErr = body?.error || "HTTP 500";
      if (attempt < retries) { await sleep(2000 * (attempt + 1)); continue; }
      return { email, status: "error", error: `server_500: ${lastErr}`, isDeliverable: false, creditsUsed: 0 };
    }

    // Anything else — return error, do not retry
    return { email, status: "error", error: `http_${status}: ${JSON.stringify(body).slice(0, 200)}`, isDeliverable: false, creditsUsed: 0 };
  }

  return { email, status: "error", error: `exhausted_retries: ${lastErr}`, isDeliverable: false, creditsUsed: 0 };
}

/**
 * Find a lead by first/last/domain.
 * Returns: { matched, data?, creditsUsed, error?, raw }
 *
 * data has: email, first_name, last_name, job_title, company_name, company_domain,
 *           industry, linkedin_url, city, state, country, employee_count,
 *           email_status, verified_at
 */
async function findByName({ first_name, last_name, domain }) {
  if (!first_name || !last_name || !domain) {
    return { matched: false, error: "missing_required_fields", creditsUsed: 0 };
  }
  const { status, body } = await request("POST", "/leads/find-by-name", { first_name, last_name, domain });

  if (status === 200 && body.success && body.data && Object.keys(body.data).length > 0) {
    return { matched: true, data: body.data, creditsUsed: body.credits_used ?? 1, raw: body };
  }
  if (status === 404) {
    return { matched: false, creditsUsed: 0, raw: body };
  }
  if (status === 402) throw new Error("Consulti: insufficient lead credits");
  if (status === 401) throw new Error("Consulti: invalid API key");

  return { matched: false, error: `http_${status}: ${JSON.stringify(body).slice(0, 200)}`, creditsUsed: 0, raw: body };
}

async function findByLinkedin(linkedin_url) {
  if (!linkedin_url) return { matched: false, error: "missing_url", creditsUsed: 0 };
  const { status, body } = await request("POST", "/leads/find-by-linkedin", { linkedin_url });
  if (status === 200 && body.success && body.data && Object.keys(body.data).length > 0) {
    return { matched: true, data: body.data, creditsUsed: body.credits_used ?? 1, raw: body };
  }
  if (status === 404) return { matched: false, creditsUsed: 0, raw: body };
  if (status === 402) throw new Error("Consulti: insufficient lead credits");
  return { matched: false, error: `http_${status}`, creditsUsed: 0, raw: body };
}

async function enrichByEmail(email) {
  if (!email) return { matched: false, error: "missing_email", creditsUsed: 0 };
  const { status, body } = await request("POST", "/leads/enrich", { email });
  if (status === 200 && body.success && body.data && Object.keys(body.data).length > 0) {
    return { matched: true, data: body.data, creditsUsed: body.credits_used ?? 1, raw: body };
  }
  if (status === 404) return { matched: false, creditsUsed: 0, raw: body };
  if (status === 402) throw new Error("Consulti: insufficient lead credits");
  return { matched: false, error: `http_${status}`, creditsUsed: 0, raw: body };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Convenience: is this verification result safe to cold-email?
 * Conservative — used to filter Mailead/Lemlist exports.
 */
function isSafeToSend(verification) {
  if (!verification || verification.status === "error") return false;
  if (verification.status === "good" && !verification.isRoleAccount && !verification.isDisposable) return true;
  return false;
}

module.exports = {
  BASE,
  getKey,
  getCredits,
  verifyEmail,
  findByName,
  findByLinkedin,
  enrichByEmail,
  isSafeToSend,
  sleep,
};
