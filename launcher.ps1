$ErrorActionPreference = 'Stop'

$parts = @(0x8F7B, 0x5F85, 0x529E, 0x8FD0, 0x884C, 0x73AF, 0x5883)
$installName = -join ($parts | ForEach-Object { [char]$_ })
$rootNameParts = @(0x7A0B, 0x5E8F)
$programFolder = -join ($rootNameParts | ForEach-Object { [char]$_ })
$nodeFolderParts = @(110, 111, 100, 101, 45, 118, 50, 52, 46, 50, 50, 46, 49, 45, 119, 105, 110, 45, 120, 54, 52)
$nodeFolder = -join ($nodeFolderParts | ForEach-Object { [char]$_ })
$installRoot = Join-Path 'D:\' $installName
$nodeExe = Join-Path (Join-Path (Join-Path $installRoot $programFolder) $nodeFolder) 'node.exe'

if (-not (Test-Path -LiteralPath $nodeExe -PathType Leaf)) {
  Write-Host 'The Node.js runtime was not found.' -ForegroundColor Red
  Write-Host "Expected: $nodeExe"
  exit 1
}

Set-Location -LiteralPath $PSScriptRoot
& $nodeExe 'server.js'
exit $LASTEXITCODE
