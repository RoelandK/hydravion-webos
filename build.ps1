# Build script for Windows PowerShell
# Produces both debug and release IPKs

$API_JS = "js/api.js"

# Guard: Object.hasOwn crashes webOS (Chrome 68)
$offenders = Get-ChildItem -Path "js" -Filter "*.js" -Recurse | Select-String -Pattern "Object.hasOwn" -SimpleMatch
if ($offenders) {
    Write-Host "FAIL: Object.hasOwn found in:" -ForegroundColor Red
    $offenders | ForEach-Object { Write-Host "  $($_)" }
    exit 1
}

# Guard: cross-file global call-site check (typos, double-prefixes)
node scripts/smoke-load.js
if ($LASTEXITCODE -ne 0) {
    Write-Host "FAIL: smoke-load (call-site check) failed" -ForegroundColor Red
    exit 1
}

function Build-Version($name, $val) {
    Write-Host "Packaging $name..." -ForegroundColor Green
    # Set DEBUG flag (use simple string replacement)
    (Get-Content $API_JS) -replace 'var DEBUG = .*', "var DEBUG = $val;" | Set-Content $API_JS -Encoding utf8
    # Build
    ares-package --no-minify . services/com.hydravion.tv.service -o . `
        --app-exclude='.git' --app-exclude='*.ipk' --app-exclude='scripts' `
        --app-exclude='*.chlsj' --app-exclude='*.chlz' --app-exclude='__pycache__' --app-exclude='reversing' `
        --app-exclude='proxy.php' --app-exclude='tv.py' --app-exclude='*.pyc' `
        --app-exclude='README.md' --app-exclude='improvements.md' `
        --app-exclude='docs' --app-exclude='*.svg' `
        --app-exclude='ui-mockup.html' --app-exclude='opencode.json' `
        --app-exclude='lib/spatial_navigation.js' `
        --app-exclude='build.ps1' --app-exclude='build.sh' 2>&1 | Out-Null
    # Rename
    Move-Item -Force com.hydravion.tv_2.1.1_all.ipk "com.hydravion.tv_${name}_2.1.1_all.ipk" -ErrorAction SilentlyContinue
    Write-Host "  -> com.hydravion.tv_${name}_2.1.1_all.ipk" -ForegroundColor Cyan
}

Build-Version "debug" "false"
Build-Version "release" "false"

# Restore to disabled (default) - remote log relay stays off
(Get-Content $API_JS) -replace 'var DEBUG = .*', 'var DEBUG = false;' | Set-Content $API_JS -Encoding utf8

Write-Host ""
Write-Host "Both IPKs built:" -ForegroundColor Green
Get-ChildItem *.ipk | ForEach-Object { Write-Host "  $($_.Name) ($($_.Length) bytes)" }
Write-Host ""
Write-Host "Install debug:   ares-install -d tv ./com.hydravion.tv_debug_2.1.1_all.ipk" -ForegroundColor Yellow
Write-Host "Install release: ares-install -d tv ./com.hydravion.tv_release_2.1.1_all.ipk" -ForegroundColor Yellow
