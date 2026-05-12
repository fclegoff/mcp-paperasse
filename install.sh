#!/usr/bin/env bash
# ============================================================
# Paperasse MCP — Installeur
# github.com/fclegoff/mcp-paperasse
# ============================================================
set -e

REPO="https://github.com/fclegoff/mcp-paperasse.git"
INSTALL_DIR="$HOME/.mcp-paperasse"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✅  $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️   $1${NC}"; }
err()  { echo -e "${RED}❌  $1${NC}"; exit 1; }
info() { echo -e "    $1"; }

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║     📎 Paperasse MCP — Installation      ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════╝${NC}"
echo ""

# ── Prérequis ────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  err "Node.js introuvable. Installez la version LTS sur https://nodejs.org puis relancez."
fi
NODE_MAJOR=$(node -e "console.log(parseInt(process.version.slice(1)))")
if [ "$NODE_MAJOR" -lt 20 ]; then
  err "Node.js $(node --version) détecté — version 20+ requise (https://nodejs.org)."
fi
ok "Node.js $(node --version)"

if ! command -v git &>/dev/null; then
  err "git introuvable. Installez git puis relancez."
fi
ok "git $(git --version | awk '{print $3}')"

# ── Téléchargement / mise à jour ─────────────────────────
echo ""
if [ -d "$INSTALL_DIR/.git" ]; then
  info "Mise à jour du dépôt existant..."
  git -C "$INSTALL_DIR" pull --quiet
  ok "Dépôt mis à jour"
else
  info "Clonage de $REPO..."
  git clone --quiet "$REPO" "$INSTALL_DIR"
  ok "Dépôt cloné dans $INSTALL_DIR"
fi

# ── Sélection des modules ────────────────────────────────
echo ""
echo -e "${BOLD}Quels modules souhaitez-vous installer ?${NC}"
echo ""

ask() {
  read -rp "  Installer $1 ? [O/n] " r; r=${r:-O}
  [[ "$r" =~ ^[Oo]$ ]]
}

INSTALL_COMPTABLE=false; INSTALL_CAC=false
INSTALL_FISCAL=false; INSTALL_NOTAIRE=false; INSTALL_SYNDIC=false

ask "comptable      — facturation, TVA, IS, FEC, journal PCG" && INSTALL_COMPTABLE=true
ask "cac            — audit commissaire aux comptes (NEP)" && INSTALL_CAC=true
ask "controleur-fiscal — simulation contrôle DGFIP"       && INSTALL_FISCAL=true
ask "notaire        — frais, plus-value, succession, SCI"  && INSTALL_NOTAIRE=true
ask "syndic         — copropriété, AG, appels de fonds"    && INSTALL_SYNDIC=true

# ── Build des modules sélectionnés ───────────────────────
echo ""
build_package() {
  local pkg="$1"
  local dir="$INSTALL_DIR/packages/$pkg"
  info "Build $pkg..."
  cd "$dir"
  npm install --ignore-scripts --silent 2>/dev/null
  npm run build --silent 2>/dev/null
  ok "$pkg prêt"
}

[ "$INSTALL_COMPTABLE" = "true" ] && build_package "mcp-comptable"
[ "$INSTALL_CAC" = "true" ]       && build_package "mcp-cac"
[ "$INSTALL_FISCAL" = "true" ]    && build_package "mcp-controleur-fiscal"
[ "$INSTALL_NOTAIRE" = "true" ]   && build_package "mcp-notaire"
[ "$INSTALL_SYNDIC" = "true" ]    && build_package "mcp-syndic"

# ── company.json pour comptable ──────────────────────────
COMPANY_PATH=""
if [ "$INSTALL_COMPTABLE" = "true" ]; then
  echo ""
  echo -e "${BOLD}Configuration mcp-comptable${NC}"
  info "Ce module nécessite un fichier company.json avec les infos de votre société."
  echo ""
  read -rp "  Chemin vers company.json [Entrée = $HOME/company.json] : " COMPANY_PATH
  COMPANY_PATH=${COMPANY_PATH:-"$HOME/company.json"}

  if [ ! -f "$COMPANY_PATH" ]; then
    warn "company.json introuvable à $COMPANY_PATH"
    info "→ Dans Claude Desktop, tapez : \"Lance le setup comptable, mon SIREN est XXXXXXXXX\""
    info "  Claude créera le fichier automatiquement."
  else
    ok "company.json trouvé"
  fi
fi

# ── Mise à jour claude_desktop_config.json ───────────────
echo ""
info "Configuration de Claude Desktop..."

if [[ "$OSTYPE" == "darwin"* ]]; then
  CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
  CONFIG="$APPDATA/Claude/claude_desktop_config.json"
else
  CONFIG="$HOME/.config/Claude/claude_desktop_config.json"
fi

mkdir -p "$(dirname "$CONFIG")"
[ ! -f "$CONFIG" ] && echo '{"mcpServers":{}}' > "$CONFIG"

python3 - <<PYEOF
import json, os, sys

config_path = r"""$CONFIG"""
install_dir = r"""$INSTALL_DIR"""
company_path = r"""$COMPANY_PATH"""

with open(config_path) as f:
    config = json.load(f)
if "mcpServers" not in config:
    config["mcpServers"] = {}

m = config["mcpServers"]
added = []

if "$INSTALL_COMPTABLE" == "true":
    m["comptable"] = {
        "command": "node",
        "args": [os.path.join(install_dir, "packages", "mcp-comptable", "dist", "index.js")],
        "env": {"COMPANY_JSON_PATH": company_path}
    }
    added.append("comptable")

if "$INSTALL_CAC" == "true":
    m["cac"] = {
        "command": "node",
        "args": [os.path.join(install_dir, "packages", "mcp-cac", "dist", "index.js")]
    }
    added.append("cac")

if "$INSTALL_FISCAL" == "true":
    m["controleur-fiscal"] = {
        "command": "node",
        "args": [os.path.join(install_dir, "packages", "mcp-controleur-fiscal", "dist", "index.js")]
    }
    added.append("controleur-fiscal")

if "$INSTALL_NOTAIRE" == "true":
    m["notaire"] = {
        "command": "node",
        "args": [os.path.join(install_dir, "packages", "mcp-notaire", "dist", "index.js")]
    }
    added.append("notaire")

if "$INSTALL_SYNDIC" == "true":
    store = os.path.join(os.path.expanduser("~"), ".mcp-syndic", "data.json")
    m["syndic"] = {
        "command": "node",
        "args": [os.path.join(install_dir, "packages", "mcp-syndic", "dist", "index.js")],
        "env": {"MCP_SYNDIC_STORE": store}
    }
    added.append("syndic")

with open(config_path, "w") as f:
    json.dump(config, f, indent=2, ensure_ascii=False)

print(f"    Modules: {', '.join(added)}")
PYEOF

# ── Fin ──────────────────────────────────────────────────
echo ""
echo -e "${BOLD}╔══════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║       ✅ Installation terminée           ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════╝${NC}"
echo ""
ok "Redémarrez Claude Desktop pour activer les modules (⌘Q puis relancer)."
echo ""
echo "  Pour mettre à jour plus tard :"
echo -e "  ${BOLD}curl -fsSL https://raw.githubusercontent.com/fclegoff/mcp-paperasse/main/install.sh | bash${NC}"
echo ""
