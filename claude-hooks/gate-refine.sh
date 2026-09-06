#!/usr/bin/env bash
# Gate: blokkeert een issue-edit met technische secties zonder functionele secties.
#
# PreToolUse-hook op Bash. Triggert op `gh issue edit.*--body-file`. Leest het
# body-bestand; bevat het `## Technische architectuur` maar ontbreekt zowel
# `## Functionele architectuur` als `## Functionele besluiten`, dan blokkeert het.

set -euo pipefail

input=$(cat)
commando=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)

# Geen commando of leeg: niets te beoordelen.
[[ -z "$commando" ]] && exit 0

# Triggert alleen op gh issue edit met --body-file.
if ! [[ "$commando" =~ gh[[:space:]]+issue[[:space:]]+edit.*--body-file ]]; then
  exit 0
fi

# Haal het pad van het body-bestand uit het commando. --body-file kan als
# `--body-file <pad>` of `--body-file=<pad>` meegaan.
body_bestand=""
if [[ "$commando" =~ --body-file[=]([^[:space:]]+) ]]; then
  body_bestand="${BASH_REMATCH[1]}"
elif [[ "$commando" =~ --body-file[[:space:]]+([^[:space:]-][^[:space:]]*) ]]; then
  body_bestand="${BASH_REMATCH[1]}"
fi

# Geen body-bestand gevonden of bestand bestaat niet: doorlaten en niet blokkeren
# op iets wat we niet kunnen lezen.
if [[ -z "$body_bestand" ]] || [[ ! -f "$body_bestand" ]]; then
  exit 0
fi

body=$(cat "$body_bestand")

# Bevat het technische secties?
if ! printf '%s' "$body" | grep -qi '^## Technische architectuur'; then
  # Geen technische secties: niets te bewaken.
  exit 0
fi

# Bevat het functionele secties?
if printf '%s' "$body" | grep -qi '^## Functionele architectuur'; then
  exit 0
fi
if printf '%s' "$body" | grep -qi '^## Functionele besluiten'; then
  exit 0
fi

# Technische secties zonder functionele secties: blokkeer.
printf '{"decision":"block","reason":"De issue-body bevat technische secties zonder functionele secties (## Functionele architectuur of ## Functionele besluiten). Voeg eerst de functionele uitwerking toe."}\n'
exit 0
