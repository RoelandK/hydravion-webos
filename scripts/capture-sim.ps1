# Capture helper for the webOS Simulator window.
# Usage: pwsh scripts/capture-sim.ps1 -OutFile "docs/img/name.png" [-Keys "RIGHT,RIGHT,ENTER"] [-DelayMs 1200]
param(
    [Parameter(Mandatory=$true)][string]$OutFile,
    [string]$Keys = "",
    [int]$DelayMs = 1200,
    [int]$WindowPid = 46112
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
'@ -Name Native -Namespace Cap
[Cap.Native]::SetProcessDPIAware() | Out-Null
$proc = Get-Process -Id $WindowPid -ErrorAction SilentlyContinue
if (-not $proc) { Write-Error "Window PID $WindowPid not found" }

# Send keys (comma-separated webOS remote keys mapped to keyboard)
if ($Keys) {
    [Cap.Native]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
    Start-Sleep -Milliseconds 200
    foreach ($k in ($Keys -split ",")) {
        switch ($k.Trim().ToUpper()) {
            "UP"    { [System.Windows.Forms.SendKeys]::SendWait("{UP}") }
            "DOWN"  { [System.Windows.Forms.SendKeys]::SendWait("{DOWN}") }
            "LEFT"  { [System.Windows.Forms.SendKeys]::SendWait("{LEFT}") }
            "RIGHT" { [System.Windows.Forms.SendKeys]::SendWait("{RIGHT}") }
            "ENTER" { [System.Windows.Forms.SendKeys]::SendWait("{ENTER}") }
            "ESC"   { [System.Windows.Forms.SendKeys]::SendWait("{ESC}") }
            "BACK"  { [System.Windows.Forms.SendKeys]::SendWait("{BACKSPACE}") }
            "HOME"  { [System.Windows.Forms.SendKeys]::SendWait("{HOME}") }
            default { [System.Windows.Forms.SendKeys]::SendWait($k) }
        }
        Start-Sleep -Milliseconds 350
    }
}
Start-Sleep -Milliseconds $DelayMs

$r = New-Object Cap.Native+RECT
[Cap.Native]::GetWindowRect($proc.MainWindowHandle, [ref]$r) | Out-Null
$w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
$dir = Split-Path -Parent $OutFile
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
$bmp.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Host "saved $OutFile ($w x $h)"
