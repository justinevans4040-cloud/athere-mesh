# Lenovo desktop launcher for ATHERE Command Deck (LIVE operator UI).
# Loads Titan/Ollama tokens from .env.local and deliberately omits Ichabod DATABASE_URL / mesh Postgres/Redis.

param(
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$EnvFile = Join-Path $RepoRoot '.env.local'
$Port = 5050
$Url = "http://127.0.0.1:$Port/"
$AllowedKeys = @(
  'TITAN_API_BEARER_TOKEN',
  'TITAN_OWNER_TOKEN',
  'TITAN_API_PORT',
  'TITAN_DECK_HOST_LABEL',
  'TITAN_WORKSPACE_ROOT',
  'OLLAMA_BASE_URL',
  'OLLAMA_MODEL',
  'OLLAMA_TIMEOUT_MS'
)
$BlockedExact = @(
  'DATABASE_URL',
  'ATHERE_MESH_POSTGRES_URL',
  'ATHERE_MESH_POSTGRES_PASSWORD',
  'ATHERE_MESH_POSTGRES_PASSWORD_FILE',
  'ATHERE_MESH_REDIS_URL',
  'ATHERE_MESH_REDIS_HOST',
  'ATHERE_MESH_REDIS_SEED_ID',
  'ATHERE_MESH_REMOTE_WORK_QUEUE',
  'ATHERE_MESH_REMOTE_REPOSITORY_ROOT',
  'FORGEFRONT_API_URL',
  'FORGEFRONT_SALES_HUNTER_INGEST',
  'PORT',
  'BASE_PATH',
  'SESSION_SECRET'
)

function Test-DeckUp {
  try {
    $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
    return ($resp.StatusCode -eq 200 -and $resp.Content -match 'COMMAND DECK')
  } catch {
    return $false
  }
}

function Import-LenovoTitanEnv {
  if (-not (Test-Path -LiteralPath $EnvFile)) {
    throw "Missing $EnvFile (need TITAN_API_BEARER_TOKEN)."
  }
  Get-Content -LiteralPath $EnvFile | ForEach-Object {
    $line = $_.Trim()
    if ($line.Length -eq 0 -or $line.StartsWith('#')) { return }
    $eq = $line.IndexOf('=')
    if ($eq -lt 1) { return }
    $key = $line.Substring(0, $eq).Trim()
    $val = $line.Substring($eq + 1).Trim()
    if ($val.StartsWith('"') -and $val.EndsWith('"')) { $val = $val.Substring(1, $val.Length - 2) }
    if ($val.StartsWith("'") -and $val.EndsWith("'")) { $val = $val.Substring(1, $val.Length - 2) }
    if ($BlockedExact -contains $key) { return }
    if ($key -like 'ATHERE_MESH_POSTGRES*' -or $key -like 'ATHERE_MESH_REDIS*') { return }
    if ($AllowedKeys -notcontains $key) { return }
    Set-Item -Path "Env:$key" -Value $val
  }
  if ([string]::IsNullOrWhiteSpace($env:TITAN_API_BEARER_TOKEN)) {
    throw 'TITAN_API_BEARER_TOKEN is required in .env.local'
  }
  if ([string]::IsNullOrWhiteSpace($env:TITAN_API_PORT)) { $env:TITAN_API_PORT = "$Port" }
  if ([string]::IsNullOrWhiteSpace($env:TITAN_DECK_HOST_LABEL)) { $env:TITAN_DECK_HOST_LABEL = 'lenovo-desktop' }
  # Hard deny Ichabod DB even if parent shell exported it.
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:ATHERE_MESH_POSTGRES_URL -ErrorAction SilentlyContinue
  Remove-Item Env:ATHERE_MESH_POSTGRES_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:ATHERE_MESH_POSTGRES_PASSWORD_FILE -ErrorAction SilentlyContinue
}

if (Test-DeckUp) {
  Write-Host "Command Deck already live at $Url"
  if (-not $NoBrowser) { Start-Process $Url }
  exit 0
}

Import-LenovoTitanEnv

$node = (Get-Command node -ErrorAction Stop).Source
$apiScript = Join-Path $RepoRoot 'scripts\start-agent-api.js'
if (-not (Test-Path -LiteralPath $apiScript)) { throw "Missing $apiScript" }

$proc = Start-Process -FilePath $node -ArgumentList @($apiScript) -WorkingDirectory $RepoRoot -PassThru -WindowStyle Minimized
Write-Host "Started Titan API pid $($proc.Id)"

$deadline = (Get-Date).AddSeconds(45)
$ready = $false
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 400
  if ($proc.HasExited) {
    throw "Titan API exited early with code $($proc.ExitCode). Check .env.local Titan/Ollama keys (no DATABASE_URL on Lenovo)."
  }
  if (Test-DeckUp) { $ready = $true; break }
}

if (-not $ready) {
  throw "Command Deck did not become ready at $Url within 45s (pid $($proc.Id))."
}

Write-Host "Command Deck live: $Url"
if (-not $NoBrowser) { Start-Process $Url }
exit 0
