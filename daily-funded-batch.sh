#!/bin/bash
# Automagic daily funded batch: pull top-N from the scored reserve -> truth-check +
# AI-score -> Reoon verify -> assemble -> one Mailead-ready CSV in Downloads ->
# Buzz ~outreach. Walks the whole reserve best-first over ~5 months, never repeating.
#
# Manual step that remains: drag the Downloads CSV into a new Mailead campaign
# (no Mailead API). Everything up to that point is automatic.
set -uo pipefail
REPO="/Users/kobestarr/Development/One Hour Vibe Coder/outreach-automation"
cd "$REPO" || exit 1
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"
BATCH="${1:-250}"
DATE=$(date +%Y-%m-%d)
TAG="daily-$DATE"
LOG="data/daily-batch-$DATE.log"
: > "$LOG"
say() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

say "pulling top $BATCH from reserve"
node daily-funded-batch.js --batch "$BATCH" >> "$LOG" 2>&1
SRC="exports/funded-batch-$DATE.csv"
[ -f "$SRC" ] || { say "reserve exhausted or nothing pulled — stopping"; exit 0; }

say "process (truth-check + AI-score)"
node process-funded-startups.js "$SRC" --tag="$TAG" >> "$LOG" 2>&1

say "verify (Reoon)"
node verify-funded-startups.js "exports/funded-startups-$TAG-checked.csv" --tag="$TAG" >> "$LOG" 2>&1

say "assemble (safe-only)"
node assemble-funded-mailead.js --warm "exports/funded-startups-$TAG-warm.csv" \
  --other "exports/funded-startups-$TAG-other.csv" --date "$DATE" --safe-only >> "$LOG" 2>&1

# merge the A/B/C route files into ONE Mailead-ready CSV in exports/ (launchd may not write to ~/Downloads:
# macOS blocks it, which silently zeroed every batch Jul to Oct 2026)
MERGED="exports/MAILEAD-Funded-Daily-$DATE.csv"
node -e '
const fs=require("fs");const g=require("path").join;const d=process.argv[1];const date=process.argv[2];
let head=null,out=[];
for(const k of ["A-buildled","B-aisearch","C-podcast"]){const f=`exports/funded-mailead-${k}-${date}.csv`;
  if(!fs.existsSync(f))continue;const [h,...rows]=fs.readFileSync(f,"utf8").trim().split("\n");if(!head){head=h;out.push(h);}out.push(...rows);}
if(head){fs.writeFileSync(process.argv[3],out.join("\n")+"\n");console.log(out.length-1);}else{console.log(0);}
' "$REPO" "$DATE" "$MERGED" > "data/.daily-count-$DATE" 2>> "$LOG"
COUNT=$(tr -dc '0-9' < "data/.daily-count-$DATE"); COUNT=${COUNT:-0}; rm -f "data/.daily-count-$DATE"
say "done: $COUNT safe leads -> $MERGED"

# Buzz ~outreach (WhatsApp bridge down since 13 Oct 2026)
MSG="Daily funded batch $DATE: $COUNT safe leads in $MERGED (not yet loaded into Mailead). Reserve walking best-first."
node mailead-alerts-buzz.js --post "$MSG" >> "$LOG" 2>&1 || say "buzz notify failed (batch still ready in $MERGED)"
