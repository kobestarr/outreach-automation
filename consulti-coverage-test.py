#!/usr/bin/env python3
"""
Consulti coverage test — 5 veins, real DB targets.
Burns ~5 verify credits + ~6 lead credits max.
"""
import os, sys, json, time, urllib.parse
import requests

KEY = os.environ.get("CONSULTI_API_KEY")
if not KEY:
    print("ERROR: CONSULTI_API_KEY not set", file=sys.stderr); sys.exit(1)

BASE = "https://www.consulti.ai/api/v1"
H = {"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}

def post(path, body):
    try:
        r = requests.post(f"{BASE}{path}", headers=H, json=body, timeout=30)
        return r.status_code, (r.json() if r.headers.get("content-type","").startswith("application/json") else r.text)
    except Exception as e:
        return 0, {"error": str(e)}

def get(path):
    r = requests.get(f"{BASE}{path}", headers=H, timeout=15)
    return r.json()

def domain_of(url):
    if not url: return None
    try:
        p = urllib.parse.urlparse(url if "://" in url else f"http://{url}")
        host = (p.netloc or p.path).lower().split("/")[0]
        if host.startswith("www."): host = host[4:]
        # Skip social URLs — not real domains
        if any(s in host for s in ["facebook.com","instagram.com","google.com","linkedin.com","x.com","twitter.com"]):
            return None
        return host
    except: return None

def summarise(label, body):
    if not isinstance(body, dict):
        print(f"  → raw: {body[:200]}"); return
    if not body.get("success"):
        print(f"  → FAIL: {body.get('error') or body}"); return
    d = body.get("data") or {}
    if "status" in d:  # verify
        print(f"  → verify: status={d.get('status')} deliverable={d.get('is_deliverable')} catch_all={d.get('is_catch_all')} role={d.get('is_role_account')} cached={d.get('cached')} cost={body.get('credits_used', d.get('credits_used'))}")
    else:  # lead
        if d:
            print(f"  → MATCH: {d.get('first_name')} {d.get('last_name')} | {d.get('job_title')} @ {d.get('company_name')} | {d.get('email')} ({d.get('email_status')}) | {d.get('linkedin_url')} | {d.get('city')}, {d.get('country')} | emp={d.get('employee_count')} | cost={body.get('credits_used')}")
        else:
            print(f"  → NO MATCH (free) | cost={body.get('credits_used')}")

# --- before
print("=" * 80)
print("CREDITS BEFORE")
print(get("/credits")["data"])
print("=" * 80)

# Test 1 — verify two emails we already have
print("\n[TEST 1] /verify on existing KSD emails (does Consulti agree with our pipeline?)")
for label, email in [
    ("Fiona Walker (info@ role)", "info@fionawalkerphotography.co.uk"),
    ("Mounting Stone (andrew@ named)", "andrew@themountingstone.co.uk"),
]:
    print(f" - {label}: {email}")
    code, body = post("/verify", {"email": email}); summarise(label, body); time.sleep(1.5)

# Test 2 — find-by-name on a UFH club WITHOUT a proper domain (predicted miss)
print("\n[TEST 2] /leads/find-by-name on UFH clubs with no real domain (free miss prediction)")
for club_name, raw_site in [
    ("Osterley Rangers", "https://www.instagram.com/osterley.rangers/"),
    ("Hindsford AFC", "https://m.facebook.com/hindsford.tonics.7"),
]:
    d = domain_of(raw_site)
    print(f" - {club_name} (site={raw_site}) → domain={d}")
    if d:
        code, body = post("/leads/find-by-name", {"first_name": club_name.split()[0], "last_name": "Secretary", "domain": d})
        summarise(club_name, body)
    else:
        print("  → SKIPPED (no real domain — Consulti can't help here)")
    time.sleep(1.5)

# Test 3 — enrich on journalists (does Consulti know UK media people?)
print("\n[TEST 3] /leads/enrich on UFH journalists (UK media coverage check)")
for name, email in [
    ("Andy Schooler", "andy@andyschoolermedia.com"),
    ("Helen Clarke", "helen.clarke@spektrix.com"),
]:
    print(f" - {name}: {email}")
    code, body = post("/leads/enrich", {"email": email}); summarise(name, body); time.sleep(1.5)

# Test 4 — find-by-name on KSD businesses where we have owner first+last+domain but NO email
print("\n[TEST 4] /leads/find-by-name on KSD owners w/ name+domain, no email (gap-fill potential)")
for first, last, site, biz in [
    ("Paul", "Bygraves", "http://www.wearesapphire.co.uk/", "Sapphire (accountant)"),
    ("Derek", "Chadderton", "http://derekchadderton.co.uk/", "Actree Accountancy"),
]:
    d = domain_of(site)
    print(f" - {biz}: {first} {last} @ {d}")
    code, body = post("/leads/find-by-name", {"first_name": first, "last_name": last, "domain": d})
    summarise(biz, body); time.sleep(1.5)

# Test 5 — verify on a likely-bad scraped email (the "Happycups" garbage row)
print("\n[TEST 5] /verify on a known-suspicious scraped row (data hygiene test)")
for label, email in [
    ("Happycups sales@", "sales@happycups.co.uk"),
    ("Let Loose info@", "info@letlooseplay.co.uk"),
]:
    print(f" - {label}: {email}")
    code, body = post("/verify", {"email": email}); summarise(label, body); time.sleep(1.5)

print("\n" + "=" * 80)
print("CREDITS AFTER")
print(get("/credits")["data"])
print("=" * 80)
