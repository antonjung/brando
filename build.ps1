# build.ps1 — increment version, commit, and push to GitHub Pages
# Usage:  .\build.ps1
#         .\build.ps1 -Message "add feature X"

param(
    [string]$Message = ""
)

Set-Location $PSScriptRoot

# ── 1. Read current version ───────────────────────────────────────────────────
$vjsPath = Join-Path $PSScriptRoot "version.js"
$vjsContent = Get-Content $vjsPath -Raw
$m = [regex]::Match($vjsContent, "(\d+)\.(\d+)\.(\d+)")
if (-not $m.Success) {
    Write-Error "Could not parse version from version.js"
    exit 1
}
$major = [int]$m.Groups[1].Value
$minor = [int]$m.Groups[2].Value
$patch = [int]$m.Groups[3].Value + 1
$newVer = "$major.$minor.$patch"

Write-Host "Bumping version to $newVer ..."

# ── 2. Write version.js ───────────────────────────────────────────────────────
[System.IO.File]::WriteAllText(
    $vjsPath,
    "window.APP_VERSION = '$newVer';",
    [System.Text.Encoding]::UTF8
)

# ── 3. Update cache name in sw.js ────────────────────────────────────────────
$swPath = Join-Path $PSScriptRoot "sw.js"
$swContent = Get-Content $swPath -Raw
$swContent = $swContent -replace "const VERSION = '\d+\.\d+\.\d+';", "const VERSION = '$newVer';"
[System.IO.File]::WriteAllText($swPath, $swContent, [System.Text.Encoding]::UTF8)

# ── 4. Ensure remote is set ──────────────────────────────────────────────────
$remotes = git remote 2>&1
if ($remotes -notcontains 'origin') {
    Write-Host "Adding GitHub remote..."
    git remote add origin https://github.com/antonjung/brando.git
}

# ── 5. Commit and push ────────────────────────────────────────────────────────
git add -A

$commitMsg = if ($Message) { "v$newVer - $Message" } else { "v$newVer" }
git commit -m $commitMsg

$branch = git rev-parse --abbrev-ref HEAD
git push origin $branch

Write-Host ""
Write-Host "Deployed v$newVer to GitHub Pages" -ForegroundColor Green
Write-Host "Live at: https://antonjung.github.io/brando/" -ForegroundColor Cyan
