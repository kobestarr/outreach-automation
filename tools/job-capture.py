#!/usr/bin/env python3
"""Daily job capture for Kobi's contract/permanent hunt. Read-only. Never applies, never emails anyone.

Sources (no LinkedIn login, so his account is never touched):
  1. LinkedIn job-alert emails in Gmail (IMAP, app password from ~/.credentials/api-keys.json)
  2. LinkedIn public guest search (same pages a logged-out visitor sees), UK remote + Manchester
Each job's public page is read for title, company, location, employment type, description.
Scored against the six CV categories; hard no-gos dropped (PR, in-person field work, MLM-style, ecommerce/Shopify-only, developer).
Lead/Senior/Head titles are KEPT (Kobi 23 Oct 2026: more conversations beat a narrow filter), just ranked lower.
Output: exports/jobs-YYYY-MM-DD.csv + one Buzz ~outreach post. Seen jobs are ledgered in data/jobs-seen.txt.

Usage: python3 -I tools/job-capture.py [--dry-run] [--since-days 3] [--no-search]
"""
import argparse, csv, datetime, email, html as H, imaplib, json, os, re, subprocess, sys, time, urllib.parse, urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEEN = os.path.join(REPO, "data", "jobs-seen.txt")
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
TERMS = ["marketing automation", "HubSpot", "paid media", "PPC", "Google Ads", "AI automation", "growth marketing",
         "marketing operations", "SEO", "demand generation", "digital marketing contractor", "fractional marketing"]
CATS = {  # category -> keywords, CV names match tools/recruiter_drafts.py
    "ai": ["ai automation", "claude", "n8n", "zapier", "make.com", "llm", "ai marketing", "prompt"],
    "automation": ["marketing automation", "hubspot", "marketo", "salesforce", "crm", "lifecycle", "marketing operations", "marketing ops", "pardot"],
    "paid": ["ppc", "paid media", "paid search", "google ads", "meta ads", "paid social", "performance marketing", "sem"],
    "seo": ["seo", "organic", "search engine", "content strategy", "aeo", "geo "],
    "fractional": ["fractional", "interim", "contract", "freelance", "consultant"],
}
NOGO = re.compile(r"\b(public relations|\bPR\b|press officer|publicist|on[- ]?site only|door[- ]to[- ]door|field sales|commission[- ]only|multi[- ]level|network marketing|shopify|woocommerce|ecommerce manager|software engineer|developer|devops|react|python developer|nurse|driver|warehouse|chef|teacher|tutor|intern(ship)?\b|apprentice)", re.I)
SENIOR = re.compile(r"\b(head of|director|vp|vice president|chief|principal)\b", re.I)
ALERTLESS = re.compile(r"(\d{9,12})")


def get(url, tries=2):
    for i in range(tries):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en-GB"}), timeout=25).read().decode("utf8", "replace")
        except Exception as e:
            if i == tries - 1: return ""
            time.sleep(8)  # LinkedIn 429s: back off


def txt(s): return re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def alert_ids(since_days):
    d = json.load(open(os.path.expanduser("~/.credentials/api-keys.json")))["gmailAccounts"]["kobestarr@gmail.com"]
    m = imaplib.IMAP4_SSL("imap.gmail.com"); m.login(d["user"], d["appPassword"]); m.select('"[Gmail]/All Mail"', readonly=True)
    since = (datetime.date.today() - datetime.timedelta(days=since_days)).strftime("%d-%b-%Y")
    ids = set()
    for i in m.search(None, f'(FROM "jobalerts-noreply@linkedin.com" SINCE {since})')[1][0].split():
        msg = email.message_from_bytes(m.fetch(i, "(RFC822)")[1][0][1])
        for p in msg.walk():
            if p.get_content_type() == "text/html":
                ids |= set(re.findall(r"jobs/view/(\d{9,12})", p.get_payload(decode=True).decode(errors="replace")))
    return ids


def search_ids(terms):
    ids = set()
    for term in terms:
        for loc, wt in (("United Kingdom", "2"), ("Manchester, England, United Kingdom", "")):
            q = {"keywords": term, "location": loc, "f_TPR": "r259200", "start": "0"}
            if wt: q["f_WT"] = wt
            page = get("https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobsSearch/search?" + urllib.parse.urlencode(q))
            ids |= set(re.findall(r"jobs/view/[^\"?]*?(\d{9,12})", page)) | set(re.findall(r"urn:li:jobPosting:(\d{9,12})", page))
            time.sleep(4)
    return ids


def read_job(jid):
    p = get(f"https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{jid}")
    if not p: return None
    g = lambda pat: txt(next(iter(re.findall(pat, p, re.S)), ""))
    desc = g(r'show-more-less-html__markup[^>]*>(.*?)</div>')
    crit = re.findall(r'description__job-criteria-subheader[^>]*>(.*?)</h3>\s*<span[^>]*>(.*?)</span>', p, re.S)
    crit = {txt(a): txt(b) for a, b in crit}
    return {"id": jid, "title": g(r'top-card-layout__title[^>]*>(.*?)</h2>') or g(r'<title>(.*?)</title>'),
            "company": g(r'topcard__org-name-link[^>]*>(.*?)</a>') or g(r'topcard__flavor"[^>]*>(.*?)</span>'),
            "location": g(r'topcard__flavor topcard__flavor--bullet[^>]*>(.*?)</span>'),
            "type": crit.get("Employment type", ""), "level": crit.get("Seniority level", ""),
            "posted": g(r'posted-time-ago__text[^>]*>(.*?)</span>'), "desc": desc,
            "url": f"https://www.linkedin.com/jobs/view/{jid}"}


def score(j):
    t = (j["title"] + " " + j["desc"]).lower()
    if NOGO.search(j["title"]) or len(NOGO.findall(j["desc"][:1500])) >= 2: return None
    remote = bool(re.search(r"\bremote\b|work from home|fully remote", t + " " + j["location"].lower()))
    hybrid = bool(re.search(r"hybrid|office days|days? in (the )?office|on[- ]site", t))
    contract = bool(re.search(r"contract|freelance|fractional|interim|day rate|outside ir35|inside ir35", t + " " + j["type"].lower()))
    cat, best = "master", 0
    for c, kws in CATS.items():
        if c == "fractional": continue
        n = sum(t.count(k) for k in kws)
        if j["title"].lower() and any(k in j["title"].lower() for k in kws): n += 5
        if n > best: cat, best = c, n
    if contract and best == 0: cat = "fractional"
    s = best + (6 if remote and not hybrid else 2 if remote else 0) + (5 if contract else 0) - (3 if SENIOR.search(j["title"]) else 0)
    if best == 0 and not contract: return None
    return {"score": s, "category": cat, "remote": "remote" if remote and not hybrid else "hybrid" if remote or hybrid else "unclear", "contract": "contract" if contract else (j["type"] or "")}


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--dry-run", action="store_true"); ap.add_argument("--since-days", type=int, default=3); ap.add_argument("--no-search", action="store_true")
    a = ap.parse_args()
    seen = set(open(SEEN).read().split()) if os.path.exists(SEEN) else set()
    ids = alert_ids(a.since_days); n_alert = len(ids)
    if not a.no_search: ids |= search_ids(TERMS)
    todo = sorted(ids - seen, reverse=True)
    print(f"{n_alert} from alert emails, {len(ids)} total, {len(todo)} new")
    rows = []
    for i, jid in enumerate(todo):
        j = read_job(jid); time.sleep(3)
        if not j: continue
        s = score(j)
        if s: rows.append({**j, **s})
    rows.sort(key=lambda r: -r["score"])
    out = os.path.join(REPO, "exports", f"jobs-{datetime.date.today()}.csv")
    cols = ["score", "title", "company", "location", "remote", "contract", "category", "level", "posted", "url"]
    if not a.dry_run:
        new = not os.path.exists(out)
        with open(out, "a", newline="") as f:
            w = csv.DictWriter(f, cols, extrasaction="ignore")
            if new: w.writeheader()
            w.writerows(rows)
        open(SEEN, "a").write("\n".join(todo) + ("\n" if todo else ""))
    top = rows[:12]
    msg = f"Jobs: {len(rows)} new fits from {len(todo)} checked ({n_alert} via LinkedIn alert emails). Top:\n" + "\n".join(
        f"- {r['title']} | {r['company']} | {r['remote']}, {r['contract'] or 'type n/a'} | CV: {r['category']}\n  {r['url']}" for r in top)
    print(msg)
    if rows and not a.dry_run:
        subprocess.run(["/usr/local/bin/node", os.path.join(REPO, "mailead-alerts-buzz.js"), "--post", msg], cwd=REPO, check=False,
                       env={**os.environ, "PATH": "/usr/local/bin:/opt/homebrew/bin:" + os.environ.get("PATH", "")})


if __name__ == "__main__": main()
