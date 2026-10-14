$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Cần cài Node.js 24 hoặc mới hơn.' }
if (-not (Test-Path -LiteralPath 'node_modules')) { npm.cmd install; if ($LASTEXITCODE -ne 0) { throw 'Cài dependencies thất bại.' } }
npm.cmd run build:css
if ($LASTEXITCODE -ne 0) { throw 'Build CSS thất bại.' }
npm.cmd start
