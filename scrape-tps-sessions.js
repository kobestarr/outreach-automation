#!/usr/bin/env node
/**
 * Scrape every session on The Podcast Show 2026 London — for each session
 * capture title, stage, startDate, endDate, and speaker slugs linked in the
 * page (the participants/performers).
 *
 * Then build a reverse lookup: speaker slug → list of sessions they're in.
 * Outputs:
 *   exports/tps-2026-sessions.jsonl
 *   exports/tps-2026-speaker-sessions.csv   (one row per speaker, with sessions joined)
 *
 * Discovered structure:
 *   /__media/sitemap_<stage-slug>.xml  → list of session URLs
 *   Each session page embeds <script type="application/ld+json"> with
 *     @type=EducationEvent: { name, startDate, endDate, location.name, performer }
 *   Speaker participation also appears as <a href="/speakers/<slug>">
 */
const fs = require("fs");
const path = require("path");

const BASE = "https://www.thepodcastshowlondon.com";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36";
const THROTTLE_MS = 600;
const OUT_DIR = path.join(__dirname, "exports");
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
const OUT_JSONL = path.join(OUT_DIR, "tps-2026-sessions.jsonl");
const OUT_CSV = path.join(OUT_DIR, "tps-2026-speaker-sessions.csv");
const sleep = ms => new Promise(r => setTimeout(r, ms));

const STAGE_SITEMAPS = [
  "the-origin-theatre", "creator-first-stage", "ask-the-experts",
  "talking-podcasts-1", "creator-stage", "tps-live-23",
  "the-podcast-show-presents",
];

async function fetchText(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/xml" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.text();
}

function extractLdJson(html) {
  const out = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    try { out.push(JSON.parse(m[1].trim())); } catch {}
  }
  return out;
}

async function listSessionUrls() {
  // Gather session URLs from each stage sitemap
  const all = new Set();
  for (const stage of STAGE_SITEMAPS) {
    try {
      const xml = await fetchText(`${BASE}/__media/sitemap_${stage}.xml`);
      const urls = (xml.match(/<loc>([^<]+)<\/loc>/g) || []).map(t => t.slice(5, -6));
      let kept = 0;
      for (const u of urls) {
        // Skip the stage-index page itself; keep individual sessions
        if (u.endsWith(`/${stage}`)) continue;
        all.add(u);
        kept++;
      }
      console.log(`  ${stage}: ${kept} sessions`);
      await sleep(200);
    } catch (e) {
      console.warn(`  ${stage}: ${e.message}`);
    }
  }
  return [...all];
}

// Load known-speaker name → slug map from our prior 442-scrape
const SPEAKERS_JSONL = path.join(__dirname, "exports", "podcast-show-london-2026-speakers.jsonl");
const NAME_TO_SLUG = new Map();
for (const line of fs.readFileSync(SPEAKERS_JSONL, "utf8").split("\n")) {
  if (!line.trim()) continue;
  try {
    const s = JSON.parse(line);
    const slug = (s.profileUrl || "").split("/speakers/")[1];
    if (slug && s.name) NAME_TO_SLUG.set(s.name.trim().toLowerCase(), slug);
  } catch {}
}
console.log(`Loaded ${NAME_TO_SLUG.size} known speaker names from prior scrape`);

async function scrapeSession(url) {
  const html = await fetchText(url);
  const blocks = extractLdJson(html);
  const event = blocks.find(b => b["@type"] === "EducationEvent" || b["@type"] === "Event");

  // Pull all image alt tags; filter to ones matching known speakers
  const alts = [...html.matchAll(/alt="([^"]+)"/g)].map(m => m[1].trim());
  const speakerNames = [...new Set(alts)]
    .filter(a => NAME_TO_SLUG.has(a.toLowerCase()));
  const speakerSlugs = speakerNames.map(n => NAME_TO_SLUG.get(n.toLowerCase()));

  return {
    url,
    title: event?.name || null,
    stage: event?.location?.name || null,
    startDate: event?.startDate || null,
    endDate: event?.endDate || null,
    speakerSlugs,
    speakerNames,
  };
}

(async () => {
  console.log("Stage sitemaps:");
  const sessionUrls = await listSessionUrls();
  console.log(`\nTotal unique session URLs: ${sessionUrls.length}`);
  console.log(`Throttle ${THROTTLE_MS}ms → ~${Math.round(sessionUrls.length * THROTTLE_MS / 1000)}s wall-clock\n`);

  const sessions = [];
  const stream = fs.createWriteStream(OUT_JSONL, { flags: "w" });
  for (let i = 0; i < sessionUrls.length; i++) {
    const url = sessionUrls[i];
    try {
      const s = await scrapeSession(url);
      sessions.push(s);
      stream.write(JSON.stringify(s) + "\n");
      if ((i + 1) % 10 === 0) {
        console.log(`  ${i + 1}/${sessionUrls.length}: ${s.title?.slice(0, 60) || "(no title)"} → ${s.speakerSlugs.length} speakers`);
      }
    } catch (e) {
      console.warn(`  ${i + 1}: ${url} → ${e.message}`);
    }
    await sleep(THROTTLE_MS);
  }
  stream.end();

  // Build reverse lookup
  const speakerSessions = new Map();
  for (const s of sessions) {
    for (const slug of s.speakerSlugs) {
      if (!speakerSessions.has(slug)) speakerSessions.set(slug, []);
      speakerSessions.get(slug).push(s);
    }
  }

  // CSV: speaker slug, count, joined session names + datetimes
  const lines = ["speaker_slug,n_sessions,sessions"];
  for (const [slug, sess] of [...speakerSessions.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const joined = sess
      .map(s => `${(s.startDate || "").slice(0, 16).replace("T", " ")} @ ${s.stage} – ${s.title}`)
      .join(" || ");
    const esc = v => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    lines.push(`${slug},${sess.length},${esc(joined)}`);
  }
  fs.writeFileSync(OUT_CSV, lines.join("\n"));
  console.log(`\n✓ Sessions JSONL: ${OUT_JSONL} (${sessions.length} sessions)`);
  console.log(`✓ Speaker→sessions CSV: ${OUT_CSV} (${speakerSessions.size} unique speakers)`);

  // === Targeted report: our 17 priority speakers (6 black + 3 brand-side + 8 green for context) ===
  const TARGETS = [
    // Black (Kobi's outreach)
    { name: "Brittany Clevenger", slug: "brittany-clevenger", tier: "BLACK - email" },
    { name: "Alex McClure",       slug: "alex-mcclure",       tier: "BLACK - email" },
    { name: "Chloe Yates",        slug: "chloe-yates",        tier: "BLACK - email" },
    { name: "Dan Rookwood",       slug: "dan-rookwood",       tier: "BLACK - email" },
    { name: "Daniel Chandley",    slug: "daniel-chandley",    tier: "BLACK - email" },
    { name: "Ed Fuller",          slug: "ed-fuller",          tier: "BLACK - email" },
    // New brand-side adds (Kobi's outreach, await Chris OK)
    { name: "Jake Storer",        slug: "jake-storer",        tier: "NEW - Nord Security" },
    { name: "Nicola Ager",        slug: "nicola-ager",        tier: "NEW - TV Licensing" },
    { name: "Margot Baume",       slug: "margot-baume",       tier: "NEW - Louis Vuitton" },
    // Green (Chris handles - for context only)
    { name: "Ali Griffin",        slug: "ali-griffin",        tier: "GREEN - Chris" },
    { name: "Andrea Marsh",       slug: "andrea-marsh",       tier: "GREEN - Chris" },
    { name: "Ben Robins",         slug: "ben-robins",         tier: "GREEN - Chris" },
    { name: "Beth Hatchett",      slug: "beth-hatchett",      tier: "GREEN - Chris" },
    { name: "Corey Layton",       slug: "corey-layton",       tier: "GREEN - Chris" },
    { name: "Faye Trinquart",     slug: "faye-trinquart",     tier: "GREEN - Chris" },
    { name: "Matt Morris",        slug: "matt-morris",        tier: "GREEN - Chris" },
    { name: "Ryan Rummery",       slug: "ryan-rummery",       tier: "GREEN - Chris" },
  ];

  console.log("\n\n=== TARGETED REPORT: SESSION TIMES FOR OUR 17 ===\n");
  for (const t of TARGETS) {
    const sess = speakerSessions.get(t.slug) || [];
    console.log(`[${t.tier}] ${t.name}`);
    if (sess.length === 0) {
      console.log(`  (no sessions found — possibly off-roster or a no-show)`);
    } else {
      for (const s of sess) {
        const start = s.startDate ? s.startDate.replace("T", " ").slice(0, 16) + " UTC" : "TBA";
        const end = s.endDate ? s.endDate.slice(11, 16) : "";
        console.log(`  • ${start}${end ? ` – ${end}` : ""} | ${s.stage || "?"} | ${s.title}`);
      }
    }
    console.log("");
  }
})();
