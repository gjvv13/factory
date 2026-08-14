#!/usr/bin/env bash
#
# setup-runner.sh — registreert een self-hosted GitHub Actions-runner op de mini
# voor één app-repo, met het label `mini`, en installeert 'm als launchd-service.
# Hoort bij de deploy-pijplijn (factory deploy / workflows/deploy.yml).
#
# Gebruik (draai dit als je gewone mini-gebruiker, NIET met sudo — de runner moet
# als die gebruiker draaien zodat pm2 en ~/AppEnvs bereikbaar zijn):
#
#   RUNNER_TOKEN=XXXX ./scripts/setup-runner.sh assistant
#   ./scripts/setup-runner.sh assistant XXXX
#
# Het token (kortlevend) haal je hier op:
#   https://github.com/gjvv13/<app>/settings/actions/runners/new
# Verlopen? Haal een nieuw op en draai opnieuw.
#
# Het token wordt bewust NIET opgeslagen; het staat alleen in het argument/de
# omgevingsvariabele van deze ene aanroep.

set -euo pipefail

OWNER="gjvv13"
APP="${1:-}"
TOKEN="${2:-${RUNNER_TOKEN:-}}"

if [[ -z "$APP" || -z "$TOKEN" ]]; then
  echo "Gebruik: ./scripts/setup-runner.sh <app> [token]" >&2
  echo "   of:   RUNNER_TOKEN=... ./scripts/setup-runner.sh <app>" >&2
  exit 1
fi

REPO_URL="https://github.com/${OWNER}/${APP}"
RUNNER_DIR="${HOME}/actions-runner-${APP}"
NAME="mini-${APP}"
LABELS="mini"

# --- Architectuur van de mini bepalen -----------------------------------------
case "$(uname -m)" in
  arm64) ARCH="arm64" ;;   # Apple silicon
  x86_64) ARCH="x64" ;;    # Intel
  *) echo "Onbekende architectuur: $(uname -m)" >&2; exit 1 ;;
esac

# --- Nieuwste runner-versie ophalen -------------------------------------------
if command -v gh >/dev/null 2>&1; then
  VER="$(gh api repos/actions/runner/releases/latest --jq .tag_name)"
else
  VER="$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest \
    | grep -o '"tag_name":[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\(v[^"]*\)"/\1/')"
fi
VER="${VER#v}"   # zonder de leidende 'v'
if [[ -z "$VER" ]]; then
  echo "Kon de nieuwste runner-versie niet bepalen." >&2
  exit 1
fi

TARBALL="actions-runner-osx-${ARCH}-${VER}.tar.gz"
DL="https://github.com/actions/runner/releases/download/v${VER}/${TARBALL}"

# --- Downloaden en uitpakken --------------------------------------------------
if [[ -d "$RUNNER_DIR" ]]; then
  echo "Map $RUNNER_DIR bestaat al. Verwijder 'm of stop een bestaande runner eerst." >&2
  echo "  (cd $RUNNER_DIR && ./svc.sh stop && ./svc.sh uninstall && ./config.sh remove --token <TOKEN>)" >&2
  exit 1
fi
mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

echo "→ Runner v${VER} (osx-${ARCH}) downloaden van github.com/actions/runner…"
curl -fSL -o "$TARBALL" "$DL"
tar xzf "$TARBALL"
rm -f "$TARBALL"

# --- Configureren -------------------------------------------------------------
echo "→ Configureren voor ${REPO_URL} met label '${LABELS}'…"
./config.sh --unattended \
  --url "$REPO_URL" \
  --token "$TOKEN" \
  --name "$NAME" \
  --labels "$LABELS" \
  --work "_work" \
  --replace

# --- Als service installeren en starten ---------------------------------------
echo "→ Als launchd-service installeren en starten…"
./svc.sh install
./svc.sh start
./svc.sh status || true

echo
echo "✓ Runner '${NAME}' draait voor ${OWNER}/${APP} met label 'mini'."
echo "  Controleer 'm ook op: ${REPO_URL}/settings/actions/runners"
