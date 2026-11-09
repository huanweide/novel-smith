# deploy-local.ps1  --  Novel Smith one-click local setup (Windows)
# Usage:  powershell -ExecutionPolicy Bypass -File deploy-local.ps1
#         powershell -ExecutionPolicy Bypass -File deploy-local.ps1 -Loopback   # 只许本机访问
#
# Prereqs: Node.js 20+ installed. No Docker, no PostgreSQL -- everything is a local SQLite file.
#
# NOTE ON BINDING: `next dev` binds ALL interfaces (0.0.0.0) by default, which means everyone on
# the same Wi-Fi can reach the app. The access guard (src/lib/net-guard.ts) lets LAN addresses
# through on purpose. If you only ever use it from this machine, pass -Loopback to bind 127.0.0.1.
param(
    [switch]$Loopback
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Need($cmd, $hint) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Write-Host "MISSING: $cmd -> $hint" -ForegroundColor Red
    exit 1
  }
}

Write-Host "== Novel Smith local setup (local SQLite, zero config) ==" -ForegroundColor Cyan
Need node "Install Node.js 20+: https://nodejs.org/"
Need npm  "npm ships with Node.js"

# 1. .env (defaults to local SQLite -- nothing to edit by hand)
if (-not (Test-Path .env)) {
  if (Test-Path .env.example) {
    Copy-Item .env.example .env
    Write-Host "[1/4] Created .env from .env.example (DATABASE_URL=file:./data/novelforge.db)" -ForegroundColor Green
  } else {
    Write-Host "[1/4] .env.example not found -- create .env manually" -ForegroundColor Red
    exit 1
  }
} else {
  Write-Host "[1/4] .env already exists, skipping" -ForegroundColor Gray
}

# 2. deps
if (-not (Test-Path node_modules)) {
  Write-Host "[2/4] npm install (first run, may take a few minutes)..." -ForegroundColor Yellow
  npm install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Write-Host "npm install failed" -ForegroundColor Red; exit 1 }
} else {
  Write-Host "[2/4] node_modules present, skipping" -ForegroundColor Gray
}

# 3. local database (auto-creates ./data/novelforge.db -- no external service needed)
Write-Host "[3/4] prisma generate + db push (local SQLite)..." -ForegroundColor Yellow
npx prisma generate
if ($LASTEXITCODE -ne 0) { Write-Host "prisma generate failed" -ForegroundColor Red; exit 1 }
npx prisma db push
if ($LASTEXITCODE -ne 0) { Write-Host "prisma db push failed -- check DATABASE_URL in .env is a file: path" -ForegroundColor Red; exit 1 }
Write-Host "Local database ready." -ForegroundColor Green

# 4. dev server
if ($Loopback) {
  $env:HOSTNAME = "127.0.0.1"
  Write-Host "[4/4] Starting dev server -> http://127.0.0.1:3001 (loopback only)" -ForegroundColor Cyan
} else {
  Write-Host "[4/4] Starting dev server -> http://localhost:3001" -ForegroundColor Cyan
  Write-Host "      (bound to all interfaces -- same-Wi-Fi devices can reach it; use -Loopback to restrict)" -ForegroundColor DarkYellow
}
Write-Host "Press Ctrl+C to stop." -ForegroundColor Gray
npm run dev
