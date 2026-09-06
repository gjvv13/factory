#!/usr/bin/env bash
# Waarschuwing: schrijft naar stderr bij een commit buiten een slice-branch.
#
# PreToolUse-hook op Bash. Triggert op `git commit`. Blokkeert niet (conform
# functioneel besluit 1); de git pre-commit hook is de harde laag.

set -euo pipefail

input=$(cat)
commando=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)

# Geen commando of leeg: niets te beoordelen.
[[ -z "$commando" ]] && exit 0

# Triggert alleen op git commit (niet op git commit-tree, git commit-graph, etc.)
if ! [[ "$commando" =~ git[[:space:]]+commit([[:space:]]|$) ]]; then
  exit 0
fi

# Bepaal de huidige branch. git rev-parse kan falen als er geen repo is;
# in dat geval is er niets te waarschuwen.
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)
[[ -z "$branch" ]] && exit 0

# Een slice-branch is goed.
if [[ "$branch" =~ ^slice/ ]]; then
  exit 0
fi

# Alles wat geen slice-branch is: waarschuw via stderr, maar blokkeer niet.
echo "⚠ Je zit op '${branch}', niet op een slice-branch. Commit je op de juiste plek?" >&2
exit 0
