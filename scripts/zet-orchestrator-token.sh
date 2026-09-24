#!/usr/bin/env bash
#
# zet-orchestrator-token.sh — plaatst de CLAUDE_CODE_OAUTH_TOKEN in de
# orchestrator-env (~/.config/factory/orkestrator.env), zodat de onbemande
# refine-, bouw- en code-review-runs weer kunnen authenticeren. Draai dit als de
# nacht-baan faalt op "OAuth session expired and could not be refreshed".
#
# Het token genereer je met:
#   claude setup-token
#
# Gebruik (draai als je gewone gebruiker; de env hoort bij jouw ~/.config):
#   ./scripts/zet-orchestrator-token.sh                 # vraagt het token (verborgen invoer)
#   ./scripts/zet-orchestrator-token.sh <token>         # token als argument
#   CLAUDE_CODE_OAUTH_TOKEN=... ./scripts/zet-orchestrator-token.sh
#   ./scripts/zet-orchestrator-token.sh --genereer      # draait eerst `claude setup-token`
#
# Het token wordt alleen naar het env-bestand geschreven (rechten 600) en nergens
# geëchood of gelogd — net als het RUNNER_TOKEN in setup-runner.sh.

set -euo pipefail

ENV_PAD="${FACTORY_ORCHESTRATOR_ENV:-$HOME/.config/factory/orkestrator.env}"
SLEUTEL="CLAUDE_CODE_OAUTH_TOKEN"

token=""
if [[ "${1:-}" == "--genereer" ]]; then
  echo "→ claude setup-token draaien; volg de instructies…" >&2
  # setup-token print het token op stdout; pak de laatste niet-lege regel. Lukt dat
  # niet (interactieve flow zonder bruikbare stdout), draai 'm dan met de hand en
  # geef het token als argument aan dit script.
  token="$(claude setup-token | tail -n1 | tr -d '[:space:]')"
elif [[ -n "${1:-}" ]]; then
  token="$1"
elif [[ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]]; then
  token="$CLAUDE_CODE_OAUTH_TOKEN"
else
  # Verborgen invoer: het token verschijnt niet op het scherm en niet in de shell-historie.
  read -r -s -p "Plak de CLAUDE_CODE_OAUTH_TOKEN (invoer blijft verborgen): " token
  echo >&2
fi

if [[ -z "$token" ]]; then
  echo "Geen token opgegeven — er is niets gewijzigd." >&2
  echo "Genereer er een met 'claude setup-token' en draai dit script opnieuw." >&2
  exit 1
fi

mkdir -p "$(dirname "$ENV_PAD")"
touch "$ENV_PAD"
chmod 600 "$ENV_PAD"

# Bestaande regel vervangen of toevoegen, zonder de rest van het bestand te raken.
# Via een tmp-bestand naast de env (zelfde map, zodat mv atomisch is en de rechten kloppen).
tmp="$(mktemp "${ENV_PAD}.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
chmod 600 "$tmp"
grep -v "^${SLEUTEL}=" "$ENV_PAD" > "$tmp" || true
printf '%s=%s\n' "$SLEUTEL" "$token" >> "$tmp"
mv "$tmp" "$ENV_PAD"
chmod 600 "$ENV_PAD"

echo "✓ ${SLEUTEL} geplaatst in ${ENV_PAD} (rechten 600). Het token is niet getoond." >&2
echo "  Controleer met: factory orkestreer status" >&2
