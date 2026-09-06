#!/usr/bin/env bash
# Gate: blokkeert merge/release zonder expliciet pad.
#
# PreToolUse-hook op Bash. Leest de tool-input (JSON) via stdin, toetst of het
# commando een factory-inlevering, een gh-merge of een push naar main is, en
# blokkeert alles wat niet langs het fastlane- of werker-pad gaat.
#
# Geen match = exit 0 zonder output = goedgekeurd.

set -euo pipefail

input=$(cat)
commando=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)

# Geen commando of leeg: niets te beoordelen.
[[ -z "$commando" ]] && exit 0

# --- factory inleveren zonder modus-vlag ---
if [[ "$commando" =~ factory[[:space:]]+inleveren ]]; then
  # Doorlaten als --fastlane of --geen-automerge meegaat.
  if [[ "$commando" =~ --fastlane ]] || [[ "$commando" =~ --geen-automerge ]]; then
    exit 0
  fi
  printf '{"decision":"block","reason":"factory inleveren zonder --fastlane of --geen-automerge is geblokkeerd. Gebruik een expliciet pad (--fastlane voor de fastlane-baan, --geen-automerge voor een werker-PR)."}\n'
  exit 0
fi

# --- gh pr merge ---
if [[ "$commando" =~ gh[[:space:]]+pr[[:space:]]+merge ]]; then
  printf '{"decision":"block","reason":"gh pr merge is geblokkeerd. Lever in via factory inleveren."}\n'
  exit 0
fi

# --- git push origin main ---
if [[ "$commando" =~ git[[:space:]]+push[[:space:]]+origin[[:space:]]+main ]]; then
  printf '{"decision":"block","reason":"git push origin main is geblokkeerd. Lever in via factory inleveren."}\n'
  exit 0
fi
