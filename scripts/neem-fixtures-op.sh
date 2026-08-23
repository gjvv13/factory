#!/usr/bin/env bash
# neem-fixtures-op.sh — herneemt de contract-test-fixtures uit echte read-only
# aanroepen. Draait NIET in de poort; alleen met de hand als de API-structuur
# is gewijzigd en de fixtures moeten meegroeien.
#
# Vereist: gh (ingelogd), jq, git. Draai vanuit de repo-root:
#   bash scripts/neem-fixtures-op.sh
#
# De opgenomen data is read-only: niets verandert op GitHub of in de repo buiten
# de fixture-bestanden.
set -euo pipefail

DIR="test/fixtures/contract"
mkdir -p "$DIR"

# -- Issue met sub-issues (epic #171, 3 slices) --------------------------------
# Gebruik een echt epic met sub-issues. Pas het nummer aan als #171 niet meer
# bestaat of een andere verhouding heeft.
EPIC=171
echo "→ issue #$EPIC (sub_issues_summary)…"
gh api "repos/gjvv13/factory/issues/$EPIC" > "$DIR/issue-sub-issues-live.json"
echo "  opgenomen als issue-sub-issues-live.json"

# -- Issue met ouder ------------------------------------------------------------
# Een issue dat #171 als ouder heeft.
KIND=186
echo "→ issue #$KIND (parent_issue_url)…"
gh api "repos/gjvv13/factory/issues/$KIND" > "$DIR/issue-met-ouder-live.json"
echo "  opgenomen als issue-met-ouder-live.json"

# -- Issue zonder ouder ---------------------------------------------------------
# Elk issue zonder parent_issue_url volstaat.
WEES=100
echo "→ issue #$WEES (zonder ouder)…"
gh api "repos/gjvv13/factory/issues/$WEES" > "$DIR/issue-zonder-ouder-live.json"
echo "  opgenomen als issue-zonder-ouder-live.json"

# -- GraphQL-opzoeking ---------------------------------------------------------
echo "→ GraphQL-opzoeking voor issue #$KIND…"
QUERY='query($eigenaar:String!,$repo:String!,$project:Int!,$nummer:Int!){
  user(login:$eigenaar){ projectV2(number:$project){ id
    field(name:"Status"){ ... on ProjectV2SingleSelectField { id options { id name } } } } }
  repository(owner:$eigenaar,name:$repo){ issue(number:$nummer){
    projectItems(first:10){ nodes { id project { number }
      fieldValueByName(name:"Status"){ ... on ProjectV2ItemFieldSingleSelectValue { name } } } } } }
}'
gh api graphql \
  -f "query=$QUERY" \
  -f eigenaar=gjvv13 \
  -f repo=factory \
  -F project=2 \
  -F "nummer=$KIND" > "$DIR/graphql-opzoek-live.json"
echo "  opgenomen als graphql-opzoek-live.json"

# -- Git-log-merges -------------------------------------------------------------
echo "→ git log v1.15.0..v1.15.1…"
git log --format=%s v1.15.0..v1.15.1 > "$DIR/git-log-merges-live.txt"
echo "  opgenomen als git-log-merges-live.txt"

# -- Integreer: gh pr list (wachtrij) ------------------------------------------
# Neemt de huidige open PR's met het wachtrij-label op. Pas het label aan als de
# wachtrij een ander label gebruikt.
echo "→ gh pr list (wachtrij-label)…"
gh pr list --state open --label wachtrij --json number,createdAt \
  > "$DIR/gh-pr-list-live.json" 2>/dev/null || echo '[]' > "$DIR/gh-pr-list-live.json"
echo "  opgenomen als gh-pr-list-live.json"

# -- Promote: /health-body ------------------------------------------------------
# Neemt de /health-body van de lokale dev-omgeving op. Pas de poort aan als de app
# op een andere poort draait; zonder draaiende app valt deze stap stil door.
echo "→ health-body (localhost:3001)…"
curl -sf http://127.0.0.1:3001/health > "$DIR/health-body-live.json" 2>/dev/null \
  || echo "(overgeslagen — geen draaiende app op :3001)"

# -- Inleveren: gh pr view (url + state) ----------------------------------------
# Neemt de huidige branch-PR op. Zonder open PR geeft gh een fout; dat is verwacht.
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
echo "→ gh pr view $BRANCH…"
gh pr view "$BRANCH" --json url,state > "$DIR/gh-pr-view-url-live.json" 2>/dev/null \
  || echo "(overgeslagen — geen PR voor $BRANCH)"

# -- Integreer: package.json (factory-dep) --------------------------------------
# Kopieert de package.json van een app als fixture. Pas het pad aan als de app
# ergens anders staat.
APP_DIR="${APP_DIR:-../assistant}"
if [ -f "$APP_DIR/package.json" ]; then
  echo "→ package.json uit $APP_DIR…"
  cp "$APP_DIR/package.json" "$DIR/app-package-live.json"
  echo "  opgenomen als app-package-live.json"
else
  echo "(overgeslagen — $APP_DIR/package.json niet gevonden)"
fi

echo ""
echo "Klaar. Bekijk de *-live.* bestanden, kopieer de relevante velden naar de"
echo "vaste fixtures (issue-sub-issues-1-3.json, gh-pr-list.json, etc.) en commit."
echo ""
echo "De live-bestanden staan in .gitignore en worden niet meegecommit — ze"
echo "bevatten de volledige API-respons, inclusief tokens en tijdstempels."
