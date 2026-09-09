# Dedicated Ichabod Command Deck tunnel ONLY.
# Lenovo http://127.0.0.1:15050/  ->  Ichabod 127.0.0.1:5050
# Do NOT multiplex ForgeFront (:18787) or Ollama (:11434) into this process.
# Lenovo-native Deck remains http://127.0.0.1:5050/ (no tunnel).

param(
  [string]$Ichabod = '100.77.131.28',
  [string]$Key = "$env:USERPROFILE\.ssh\id_ed25519",
  [int]$LocalPort = 15050,
  [int]$RemotePort = 5050
)

$ErrorActionPreference = 'Stop'

function Test-LocalPort([int]$Port) {
  return [bool](Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

if ($LocalPort -in 5050, 18787, 11434) {
  throw "Refusing LocalPort=$LocalPort - use 15050 for Ichabod Deck tunnel only."
}

if (Test-LocalPort $LocalPort) {
  try {
    $probe = Invoke-WebRequest -Uri "http://127.0.0.1:$LocalPort/" -TimeoutSec 4 -UseBasicParsing
    Write-Output "Ichabod Deck tunnel already live on 127.0.0.1:$LocalPort (status $($probe.StatusCode))"
    exit 0
  } catch {
    throw "127.0.0.1:$LocalPort is listening but Deck home failed. Refusing to clobber."
  }
}

$remote = ssh -i $Key -o BatchMode=yes -o ConnectTimeout=15 "the_founder@$Ichabod" "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$RemotePort/"
if ($remote -notin @('200','401')) {
  throw "Ichabod Deck :$RemotePort returned '$remote'."
}

& ssh -i $Key -N -f -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 `
  -L "127.0.0.1:${LocalPort}:127.0.0.1:${RemotePort}" "the_founder@$Ichabod"
Start-Sleep -Seconds 1
if (-not (Test-LocalPort $LocalPort)) { throw "Deck tunnel not listening on $LocalPort" }
$home = Invoke-WebRequest -Uri "http://127.0.0.1:$LocalPort/" -TimeoutSec 5 -UseBasicParsing
Write-Output "Ichabod Deck dedicated tunnel UP http://127.0.0.1:$LocalPort/ -> :$RemotePort (home=$($home.StatusCode))"
Write-Output "  NOTE: separate from ForgeFront :18787 and Ollama :11434; Lenovo Deck stays :5050"
