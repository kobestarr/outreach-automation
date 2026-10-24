#!/usr/bin/env python3
"""Vault link report: visits by source and PDF downloads by source and by deck.
Reads the redirect log on kobestarr.io over SSH. A download is attributed to the last vault link
(vault-li, vault-nl, vault-dm, vault) clicked by the same hashed visitor in the 24 hours before it.
Bots, link previews and tests are filtered out by browser string. Usage: python3 vault-report.py [--since 2026-10-22]"""
import csv, io, subprocess, sys, collections, datetime as dt
since = sys.argv[sys.argv.index("--since")+1] if "--since" in sys.argv else "2026-10-22"
raw = subprocess.check_output(["ssh","-i",__import__("os").path.expanduser("~/.ssh/kobestarr_hostinger"),"-p","65002","-o","BatchMode=yes","u791079479@194.36.186.158","cat /home/u791079479/redirect-logs/coach-links.csv"]).decode()
BOT = ("bot","crawl","spider","preview","linkedinbot","slackbot","facebookexternalhit","whatsapp","curl","python","go-http","headless","wget","okhttp","node-fetch")
SRC = {"vault-li":"LinkedIn post","vault-nl":"LinkedIn newsletter","vault-dm":"LinkedIn DMs","vault":"QR / direct (kobestarr.io/vault)"}
ev = []
for r in csv.reader(io.StringIO(raw)):
    if len(r) < 6 or r[0] < since: continue
    t, slug, medium, vis, ref, ua = r[:6]
    if any(b in ua.lower() for b in BOT): continue
    ev.append((dt.datetime.fromisoformat(t), slug, medium, vis))
ev.sort()
visits = collections.defaultdict(list); last = {}
downloads = collections.Counter(); by_deck = collections.defaultdict(collections.Counter); dl_people = collections.defaultdict(set)
for t, slug, medium, vis in ev:
    if slug in SRC:
        visits[slug].append(vis); last[vis] = (t, slug)
    elif slug == "vault-get":
        src = "Unknown / not via a tracked link"
        if vis in last and (t - last[vis][0]) <= dt.timedelta(hours=24): src = SRC[last[vis][1]]
        downloads[src] += 1; by_deck[medium][src] += 1; dl_people[src].add(vis)
print(f"Vault link report since {since} (humans only)\n")
print("VISITS TO THE VAULT PAGE, by link")
for s, name in SRC.items(): print(f"  {name:36} {len(visits[s]):4} clicks  {len(set(visits[s])):4} people")
print("\nPDF DOWNLOADS, by where the person came from")
for s in list(SRC.values()) + ["Unknown / not via a tracked link"]:
    if downloads[s]: print(f"  {s:36} {downloads[s]:4} downloads  {len(dl_people[s]):4} people")
print(f"  {'TOTAL':36} {sum(downloads.values()):4} downloads")
print("\nDOWNLOADS BY DECK")
for d in sorted(by_deck): print(f"  {d:8} {sum(by_deck[d].values()):4}  " + ", ".join(f"{k}: {v}" for k, v in by_deck[d].most_common()))
