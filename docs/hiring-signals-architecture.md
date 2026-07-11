# Signal Engine — architecture + data contract (v2, post-skeptic)

Pipeline that turns LinkedIn hiring signals into a triaged, founder-direct lead digest.
Build & stage only. Branch `hiring-signals-pipeline`. Modules pure-ish + io-injected + TDD, matching
`send-batch.js` / `decision-maker-resolver.js`. v2 integrates the Systems-Skeptic fixes (see `decisions.md`).

## THE CANONICAL RECORD (the one rule that makes parallel building safe)
Every stage receives ONE `SignalRecord` and returns it **with its fields added** (accreting merge),
keyed by `jobId`. No stage returns a standalone object. A stage that can't process a record sets its
own fields to null/`review` and passes it on — records are never dropped from the array, only labelled.

```
SignalRecord = {
  // -- from source --
  jobId, jobUrl, brand, term, roleTitle (cleaned), companyName, location, workplaceType, salary|null,
  easyApply, isPromoted, jobDescription: null,          // JD/poster NOT returned by searchJobs -> null (v1)
  posterEmail: null, posterName: null,                  // resolver's JD/recruiter-poster routes stay dormant v1
  // -- added by gate --
  companyDomain: null, companyOneLiner: null, businessType: 'business'|'brand'|'unknown',
  sizeBand: 'small'|'mid'|'large'|'unknown', estimatedHeadcount: number|null,  // <- feeds resolver
  isRealEmployer: bool, lane: 'small-direct'|'mid-augmentation'|'website-pitch'|'review'|'drop',
  dropReason: null|string, gateConfidence: 0..1,
  // -- added by resolver (existing module) --
  dmName: null, dmTitle: null, dmLinkedIn: null, dmConfidence: 0, dmSources: [], segment: null,
  // -- added by enrich --
  email: null, reoonStatus: null, emailSource: null, contactConfidence: 0,
  linkedinResolved: false,                              // true only if a REAL profile confirmed same-company
  // -- added by digest --
  verdict: 'REACH'|'LOOK'|'DROP', why: null
}
```

## Flow (every step mutates the same record array)
```
1 hiring-signal-source.js  -> SignalRecord[] (source fields; roleTitle cleaned; jobId dedup + company cooldown)
2 company-quality-gate.js  -> stage A hard rules (no I/O) set lane=drop/review early;
                              stage B (survivors, COLLAPSED TO UNIQUE COMPANY, cached): resolveDomain ->
                              fetch+LLM one-liner+sizeBand+businessType -> set lane + estimatedHeadcount
3 decision-maker-resolver  -> for lane in {small-direct,mid-augmentation,website-pitch,review}: classify+resolve
   (EXISTING)                 passing {companyName, companyDomain, companyHeadcount: estimatedHeadcount,
                              roleTitle, brand} -> dm* fields
4 enrich-decision-maker.js -> email (website auto-valid -> pattern+Reoon SAFE-ONLY, short-circuit first safe)
                              + linkedinUrl (resolved+company-confirmed only) -> email/reoon/linkedinResolved
5 build-digest.js          -> verdict per thresholds; render chat+file; split emailLead[]/prospConnect[]/
                              manualFind[]/websitePitch[]
```

## Key decisions baked in (from skeptic)
- **companyDomain producer:** gate stage B FIRST does `resolveDomain(companyName, location)` — web-search
  the name + pick the best-matching non-social domain, or null. No domain -> lane may become `website-pitch`
  (a FEATURE: no site = pitch them a site), not a silent drop.
- **One size taxonomy:** gate sets `estimatedHeadcount` from its size read (small≈10, mid≈100, large≈600);
  resolver consumes THAT as `companyHeadcount`. Never leave it null when sizeBand is known.
- **roleTitle** is the canonical field name (matches resolver). jobDescription/poster stay null in v1
  (searchJobs doesn't return them) -> resolver's jdReportingLine + recruiter-poster routes are dormant,
  recruiter-catching lives in the gate. Documented, not accidental.
- **No hard-drop of your own targets:** hard rules require a CORROBORATING token, not a bare substring.
  Drop `\bhire\b` bare (kills "Van Hire Ltd"); recruiter needs name-token AND non-employer signal.
  NEVER drop "Marketing & Communications Manager" (it's a marketing hire). Borderline name hits -> `review`
  lane (human look), not `drop`.
- **LinkedIn no-guess + confirm:** attach a URL only if a real profile is found AND confirms current company.
  Unresolved-but-hot -> `manualFind[]` bucket in the digest (never silently lost).
- **Reoon:** short-circuit on first `safe`; catch-all/unknown/anything-not-safe -> email=null; run guarded
  against daily cap (stop enriching, queue overflow).
- **Dedup:** exact on `jobId`; PLUS company-level cooldown via resolver `normName(companyName)` — suppress
  same company for 21 days regardless of role/title-variant. Append-only ledger read once at start.
- **Unique-company collapse:** before stage-B enrich, collapse survivors to unique companies, enrich once,
  cache one-liner/domain/sizeBand back onto all that company's records. Hard cap per run -> overflow queue.
- **Verdict thresholds:** REACH = has contact (email or confirmed LinkedIn) AND gateConfidence≥0.6 AND
  dmConfidence≥0.6; LOOK = hot but missing contact or confidence 0.4-0.6 (incl. person:null hot, manualFind,
  website-pitch); DROP = dropReason set or confidence<0.4.

## Per-brand search config
- kobestarr: ['SEO manager','digital marketing manager','growth manager','head of marketing'] UK pastWeek.
- stripped: ['podcast producer','audio producer','content producer'] UK pastWeek.
- dealflow: ['content marketing manager','content manager'] UK pastWeek (business-not-brand gate does the rest).

## Hard rules (gate stage A — corroboration required, borderline -> review)
- recruiter: name ~ /recruit|staffing|headhunt|\btalent (solutions|acquisition|partners)|search partners|
  better placed|searchability|digital waffle|forward role|get recruited|hays|reed|michael page|adecco|randstad/i
  (NOT bare `hire`/`talent`/`resourc`). "Role at RealCo @ Recruiter" title pattern -> `review` (manual look), not drop.
- gig-platform: /alignerr|mercor|invisible tech|meridial|crossing hurdles|remotasks|scale ai|outlier ai/i -> drop.
- agency-competitor: name ~ /vaynermedia|digitas|\bthe dubs\b/i OR (/\bagency\b/i AND role marketing/content) -> drop.
- pr-role: title ~ /\bPR\b|public relations|press officer|media relations/i -> drop. (KEEP "marketing & comms".)
- in-person-role: title ~ /videograph|photograph|camera operator|event (producer|manager|coordinator)|
  field marketing|retail|ambassador|in-store|barista/i -> drop.
- giant: known-big list AND large size signal -> drop (flag warm-route override, don't auto-pursue).

## Reuse (built)
decision-maker-resolver.js (18 tests), reoon-verifier, llm-owner-extractor, website-scraper,
Companies House adapter (Basic base64(apiKey+':')), linkedapi.io searchJobs (async poll ~5min), linkdapi people.

## Non-negotiables
No overnight sends. No guessed LinkedIn URLs. Reoon safe-only. PR + in-person always dropped.
Records are labelled, never silently deleted. Every module TDD + adversarially reviewed before commit.
