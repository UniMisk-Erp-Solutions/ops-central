# Deploy Edge Function to Coolify Supabase on LAN server (from Windows working PC)
param(
  [string]$Server = "mithilmistry@192.168.16.112",
  [string]$ServiceId = "hws00sks44g8k04k8wccooco",
  [string]$FunctionName = "main",
  [string]$LocalFile = "supabase\functions\main\index.ts"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$Source = Join-Path $ProjectRoot $LocalFile

if (-not (Test-Path $Source)) {
  Write-Host "Local file not found: $Source"
  Write-Host "Create it first, or pass -LocalFile path\to\index.ts"
  exit 1
}

$RemoteTmp = "/tmp/${FunctionName}-index.ts"
$RemoteVol = "/data/coolify/services/${ServiceId}/volumes/functions/${FunctionName}/index.ts"
$EdgeContainer = "supabase-edge-functions-${ServiceId}"

Write-Host "Upload: $Source -> ${Server}:${RemoteTmp}"
scp $Source "${Server}:${RemoteTmp}"

$RemoteScript = @"
set -e
sudo cp '$RemoteTmp' '$RemoteVol'
sudo docker restart '$EdgeContainer' 2>/dev/null || sudo docker ps --format '{{.Names}}' | grep 'supabase-edge-functions-${ServiceId}' | head -1 | xargs -r sudo docker restart
sleep 2
curl -s -o /dev/null -w 'Edge %{http_code}\n' http://127.0.0.1:54321/functions/v1/${FunctionName}
"@

Write-Host "Install on server and restart edge runtime..."
ssh $Server $RemoteScript

Write-Host "Test from working PC:"
Write-Host "  curl -i http://192.168.16.112:54321/functions/v1/${FunctionName}"
