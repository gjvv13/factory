#!/usr/bin/env bash
# Gate: blokkeert directe merge en push naar main.
#
# PreToolUse-hook op Bash. Leest de tool-input (JSON) via stdin, toetst of het
# commando een gh-merge of een push naar main is, en blokkeert die. `factory
# inleveren` is altijd toegestaan — het label `auto-merge-ok` op het issue
# bepaalt of auto-merge aangaat (#573).
#
# Geen match = exit 0 zonder output = goedgekeurd.

set -euo pipefail

input=$(cat)
commando=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)

# Geen commando of leeg: niets te beoordelen.
[[ -z "$commando" ]] && exit 0

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
