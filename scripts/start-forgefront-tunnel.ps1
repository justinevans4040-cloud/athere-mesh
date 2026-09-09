# Dedicated ForgeFront Systems tunnel ONLY.
# Lenovo http://127.0.0.1:18787/  ->  Ichabod 127.0.0.1:8787
# Do NOT multiplex Deck (:15050), Ollama (:11434), or Postgres into this process.

param(
  [string]$Ichabod = '100.77.131.28',
  [string]$Key = "$env:USERPROFILE\.ssh\id_ed25519",
  [int]$LocalPort = 18787,
  [int]$RemotePort = 8787
)

$ErrorActionPreference = 'Stop'

function Test-LocalPort([int]$Port) {
  return [bool](Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

if ($LocalPort -in 5050, 15050, 11434) {
  throw "Refusing LocalPort=$LocalPort - reserved for Deck/Ollama. ForgeFront uses 18787."
}

if (Test-LocalPort $LocalPort) {
  $probe = Invoke-WebRequest -Uri "http://127.0.0.1:$LocalPort/api/health" -TimeoutSec 4 -UseBasicParsing
  Write-Output "ForgeFront tunnel already live on 127.0.0.1:$LocalPort (health $($probe.StatusCode))"
  exit 0
}

$remote = ssh -i $Key -o BatchMode=yes -o ConnectTimeout=15 "the_founder@$Ichabod" "curl -s -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:$RemotePort/api/health"
if ($remote -ne '200') {
  throw "Ichabod ForgeFront :$RemotePort health returned '$remote' (want 200)."
}

# Windows: use Start-Process (ssh -f is unreliable here)
$proc = Start-Process -FilePath 'ssh.exe' -ArgumentList @(
  '-i', $Key,
  '-N',
  '-o', 'BatchMode=yes',
  '-o', 'ExitOnForwardFailure=yes',
  '-o', 'ServerAliveInterval=30',
  '-o', 'ServerAliveCountMax=3',
  '-L', "127.0.0.1:${LocalPort}:127.0.0.1:${RemotePort}",
  "the_founder@$Ichabod"
) -WindowStyle Hidden -PassThru

Start-Sleep -Seconds 2
if (-not (Test-LocalPort $LocalPort)) {
  throw "Tunnel pid $($proc.Id) started but 127.0.0.1:$LocalPort is not listening."
}

$health = Invoke-RestMethod -Uri "http://127.0.0.1:$LocalPort/api/health" -TimeoutSec 5
$home = Invoke-WebRequest -Uri "http://127.0.0.1:$LocalPort/" -TimeoutSec 5 -UseBasicParsing
$pm = Invoke-WebRequest -Uri "http://127.0.0.1:$LocalPort/pm" -TimeoutSec 5 -UseBasicParsing

Write-Output "ForgeFront dedicated tunnel UP (ssh pid $($proc.Id))"
Write-Output "  local:  http://127.0.0.1:$LocalPort/  (Solar)  /pm (PM)"
Write-Output "  remote: ichabod 127.0.0.1:$RemotePort"
Write-Output "  product=$($health.product) brand=$($health.brand)"
Write-Output "  home=$($home.StatusCode) pm=$($pm.StatusCode)"
Write-Output "  NOTE: separate process from Deck and Ollama tunnels"
