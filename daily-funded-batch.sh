#!/bin/bash
# Automagic daily funded batch: pull top-N from the scored reserve -> truth-check +
# AI-score -> Reoon verify -> assemble -> one Mailead-ready CSV in Downloads ->
# WhatsApp Kobi. Walks the whole reserve best-first over ~5 months, never repeating.
#
# Manual step that remains: drag the Downloads CSV into a new Mailead campaign
# (no Mailead API). Everything up to that point is automatic.
set -uo pipefail
REPO="/Users/kobestarr/Development/One Hour Vibe Coder/outreach-automation"
cd "$REPO" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
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

# merge the A/B/C route files into ONE Mailead-ready CSV in Downloads
MERGED="$HOME/Downloads/MAILEAD-Funded-Daily-$DATE.csv"
node -e '
const fs=require("fs");const g=require("path").join;const d=process.argv[1];const date=process.argv[2];
let head=null,out=[];
for(const k of ["A-buildled","B-aisearch","C-podcast"]){const f=`exports/funded-mailead-${k}-${date}.csv`;
  if(!fs.existsSync(f))continue;const [h,...rows]=fs.readFileSync(f,"utf8").trim().split("\n");if(!head){head=h;out.push(h);}out.push(...rows);}
if(head){fs.writeFileSync(process.argv[3],out.join("\n")+"\n");console.log(out.length-1);}else{console.log(0);}
' "$REPO" "$DATE" "$MERGED" >> "$LOG" 2>&1
COUNT=$(($(wc -l < "$MERGED" 2>/dev/null || echo 1)-1))
say "done: $COUNT safe leads -> $MERGED"

# WhatsApp Kobi
MSG="Daily funded batch $DATE ready: $COUNT safe leads in Downloads (MAILEAD-Funded-Daily-$DATE.csv). Load into a new Mailead campaign. Reserve walking best-first."
ssh -o ConnectTimeout=10 clawdbot 'TOKEN=$(cat /root/.trendmine-internal-token); curl -s -X POST \
  -H "X-Internal-Token: $TOKEN" -H "Content-Type: application/json" \
  -d "{\"to\":\"447989746146\",\"message\":\"'"$MSG"'\",\"source\":\"daily-funded-batch\"}" \
  http://localhost:3848/send-direct' >/dev/null 2>&1 || say "whatsapp notify failed (batch still ready in Downloads)"
