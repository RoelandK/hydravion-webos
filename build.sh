#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
info() { echo -e "${GREEN}[INFO]${NC} $1"; }
error() {
	echo -e "${RED}[ERROR]${NC} $1"
	exit 1
}

command -v node >/dev/null 2>&1 || error "Node.js is required."
command -v ares-package >/dev/null 2>&1 || error "ares-package not found. Install: npm install -g @webos-tools/cli"

API_JS="js/api.js"

# ── Debug build ────────────────────────────────────────────────────────
info "Packaging DEBUG..."
sed -i 's/var DEBUG = .*/var DEBUG = true;/' "$API_JS"
ares-package --no-minify . services/com.hydravion.tv.service -o . \
--app-exclude='.git' --app-exclude='*.ipk' --app-exclude='scripts' 
--app-exclude='*.chlsj' --app-exclude='__pycache__' --app-exclude='reversing' 
--app-exclude='proxy.php' --app-exclude='tv.py' --app-exclude='*.pyc' 
--app-exclude='README.md' --app-exclude='improvements.md' 
--app-exclude='docs' --app-exclude='*.svg' 
--app-exclude='ui-mockup.html' --app-exclude='opencode.json' 
--app-exclude='lib/spatial_navigation.js' 
--app-exclude='build.ps1' --app-exclude='build.sh' 2>&1 | grep -v Excluded
mv -f com.hydravion.tv_2.0.0_all.ipk com.hydravion.tv_debug_2.0.0_all.ipk 2>/dev/null || true
info "  -> com.hydravion.tv_debug_2.0.0_all.ipk"

# ── Release build ──────────────────────────────────────────────────────
info "Packaging RELEASE..."
sed -i 's/var DEBUG = .*/var DEBUG = false;/' "$API_JS"
ares-package --no-minify . services/com.hydravion.tv.service -o . \
--app-exclude='.git' --app-exclude='*.ipk' --app-exclude='scripts' 
--app-exclude='*.chlsj' --app-exclude='__pycache__' --app-exclude='reversing' 
--app-exclude='proxy.php' --app-exclude='tv.py' --app-exclude='*.pyc' 
--app-exclude='README.md' --app-exclude='improvements.md' 
--app-exclude='docs' --app-exclude='*.svg' 
--app-exclude='ui-mockup.html' --app-exclude='opencode.json' 
--app-exclude='lib/spatial_navigation.js' 
--app-exclude='build.ps1' --app-exclude='build.sh' 2>&1 | grep -v Excluded
mv -f com.hydravion.tv_2.0.0_all.ipk com.hydravion.tv_release_2.0.0_all.ipk 2>/dev/null || true
info "  -> com.hydravion.tv_release_2.0.0_all.ipk"

# ── Restore to debug (default) ──────────────────────────────────────────
sed -i 's/var DEBUG = .*/var DEBUG = true;/' "$API_JS"

info ""
info "Both IPKs built:"
ls -la *.ipk 2>/dev/null | awk '{print "  " $NF " (" $5 " bytes)"}'
info ""
info "Install debug:   ares-install -d tv ./com.hydravion.tv_debug_2.0.0_all.ipk"
info "Install release: ares-install -d tv ./com.hydravion.tv_release_2.0.0_all.ipk"
