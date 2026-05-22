#!/usr/bin/env bash
# Extract every recipient + first-name + date from the Nigel Stephens doctor outreach.
# Combines the page-2 + page-3 Gmail dumps. Outputs CSV.
set -euo pipefail

OUT="exports/doctors-website-2024-recipients.csv"
DUMPS_DIR="/Users/kobestarr/.claude/projects/-Users-kobestarr-Development-One-Hour-Vibe-Coder-outreach-automation/61f1e21a-f10b-428f-9b97-3a8abf16abb2/tool-results"

mkdir -p exports
echo "email,first_name,first_sent_date,subject_pattern,domain_class" > "$OUT"

# Walk both dumps + emit one row per (recipient, earliest date)
for f in "$DUMPS_DIR"/mcp-claude_ai_Gmail-search_threads-1779046381679.txt \
         "$DUMPS_DIR"/mcp-claude_ai_Gmail-search_threads-1779046440266.txt; do
  jq -r '
    .threads[].messages[]
    | select(.labelIds | index("SENT"))
    | select(.subject | test("Nigel Stephens"; "i"))
    | [.date[0:10], .subject, .toRecipients[0]]
    | @tsv
  ' "$f"
done | awk -F'\t' '
  {
    date = $1; subject = $2; email = tolower($3);
    # Extract first name from "A website like Dr Nigel Stephens' NAME?" or "Website like Dr Nigel Stephens, NAME?"
    match(subject, /Stephens['\''"][\s ]?([A-Za-z]+)/, m1);
    match(subject, /Stephens,[\s ]?([A-Za-z]+)/, m2);
    fn = m1[1] != "" ? m1[1] : m2[1];
    if (fn == "") fn = "?";
    # Keep earliest date per email
    if (!(email in first_seen) || date < first_seen[email]) {
      first_seen[email] = date;
      first_name[email] = fn;
      subject_pattern[email] = subject;
    }
  }
  END {
    for (e in first_seen) {
      # Classify domain
      d = e; sub(/^.*@/, "", d);
      cls = "other";
      if (d ~ /\.nhs\.(net|uk)$/ || d ~ /\.nhs\./) cls = "nhs";
      else if (d ~ /\.ac\.uk$/) cls = "academic";
      else if (d ~ /doctors\.org\.uk$/) cls = "doctors-org-uk";
      else if (d ~ /\.(co\.uk|com|net|org|md|sa|it|in)$/) cls = "private-or-personal";
      print e "," first_name[e] "," first_seen[e] "," subject_pattern[e] "," cls;
    }
  }
' | sort -u >> "$OUT"

# Add page-1 recipients (from in-context Gmail search results — not in dump files)
cat <<'PAGE1' >> "$OUT"
aaishaopel@aol.com,Aaisha,2024-02-08,A website like Dr Nigel Stephens' Aaisha?,private-or-personal
davidsarkar@hotmail.com,David,2024-02-08,A website like Dr Nigel Stephens' David?,private-or-personal
d.w.s.chong@gmail.com,Dennis,2024-02-08,A website like Dr Nigel Stephens' Dennis?,private-or-personal
voiseysmith@talk21.com,Dave,2024-02-08,A website like Dr Nigel Stephens' Dave?,private-or-personal
dianebarker@hotmail.com,Diane,2024-02-08,A website like Dr Nigel Stephens' Diane?,private-or-personal
gupta_dhiraj@hotmail.com,Dhiraj,2024-02-08,A website like Dr Nigel Stephens' Dhiraj?,private-or-personal
justin.taylor@wales.nhs.uk,Justin,2024-02-08,A website like Dr Nigel Stephens' Justin?,nhs
justin.zaman@jpaget.nhs.uk,Justin,2024-02-08,A website like Dr Nigel Stephens' Justin?,nhs
justin.barclay@nhs.net,Justin,2024-02-08,A website like Dr Nigel Stephens' Justin?,nhs
manav.sohal@stgeorges.nhs.uk,Manav,2024-02-08,A website like Dr Nigel Stephens' Manav?,nhs
dr.szantho@gmail.com,Gergely,2024-02-08,A website like Dr Nigel Stephens' Gergely?,private-or-personal
janebrennandroper@msn.com,David,2024-02-08,A website like Dr Nigel Stephens' David?,private-or-personal
abhayuk@hotmail.com,Abhay,2024-02-08,A website like Dr Nigel Stephens' Abhay?,private-or-personal
raisoval@ngha.med.sa,Lenka,2024-02-08,A website like Dr Nigel Stephens' Lenka?,private-or-personal
abutariqtaher@hotmail.com,Abutariq,2024-02-08,A website like Dr Nigel Stephens' Abutariq?,private-or-personal
donahez@yahoo.com,Donah,2024-02-08,A website like Dr Nigel Stephens' Donah?,private-or-personal
moore1@doctors.org.uk,Michael,2024-02-08,A website like Dr Nigel Stephens' Michael?,doctors-org-uk
j.grapsa@rbht.nhs.uk,Julia,2024-02-08,A website like Dr Nigel Stephens' Julia?,nhs
lecoats@doctors.org.uk,Louise,2024-02-08,A website like Dr Nigel Stephens' Louise?,doctors-org-uk
PAGE1

# Final dedup pass on the merged file (some page-1 may also be in dumps)
{ head -1 "$OUT"; tail -n +2 "$OUT" | sort -u -t',' -k1,1; } > "${OUT}.tmp" && mv "${OUT}.tmp" "$OUT"

echo "Wrote $(wc -l < "$OUT" | tr -d ' ') lines (incl. header)"
echo "Unique recipients: $(tail -n +2 "$OUT" | wc -l | tr -d ' ')"
echo
echo "By domain class:"
tail -n +2 "$OUT" | awk -F',' '{print $5}' | sort | uniq -c | sort -rn
