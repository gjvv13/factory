#!/usr/bin/env bash
# Neemt een sessielog-fixture op voor de contracttests van src/sessielog.ts (#542).
#
# Gebruik:
#   scripts/neem-sessielog-fixture-op.sh <sessie-id> <werkmap>
#
# Voorbeeld:
#   scripts/neem-sessielog-fixture-op.sh b2388f0e-... /Users/gjvv/OrkestratorWerk/factory-wt/91
#
# Het script zoekt het JSONL-bestand in ~/.claude/projects/, filtert op regels met
# toolDenialKind (de weigeringen) plus een paar context-regels, en schrijft het naar
# test/fixtures/contract/sessielog-met-weigeringen.jsonl.
#
# Draai dit NIET in de poort — het is een opneemhulpmiddel, analoog aan neem-fixtures-op.sh.

set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Gebruik: $0 <sessie-id> <werkmap>" >&2
  exit 1
fi

SESSIE_ID="$1"
WERKMAP="$2"
ENCODED_CWD="${WERKMAP//\//-}"
BRONPAD="$HOME/.claude/projects/${ENCODED_CWD}/${SESSIE_ID}.jsonl"
DOELPAD="$(cd "$(dirname "$0")/.." && pwd)/test/fixtures/contract/sessielog-met-weigeringen.jsonl"

if [[ ! -f "$BRONPAD" ]]; then
  echo "Sessielog niet gevonden: $BRONPAD" >&2
  echo "Probeer een ander pad of controleer de sessie-id." >&2
  exit 1
fi

# Kopieer het volledige bestand; de fixture is het hele log van een run met bekende
# weigeringen. De tests pinnen de parser vast tegen dit bestand.
cp "$BRONPAD" "$DOELPAD"

REGELS=$(wc -l < "$DOELPAD" | tr -d ' ')
WEIGERINGEN=$(grep -c '"toolDenialKind"' "$DOELPAD" || true)

echo "Opgenomen: ${REGELS} regels, waarvan ${WEIGERINGEN} weigeringen."
echo "Fixture: ${DOELPAD}"
