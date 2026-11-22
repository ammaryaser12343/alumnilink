param([switch]$Stop, [switch]$NoOpen)
$ErrorActionPreference = 'Stop'
$servicePath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\profile-api')).Path
$testExitCode = 0
if (-not $Stop) {
    Write-Host 'Checking the local Floci containers...'
    & docker compose --env-file (Join-Path $PSScriptRoot '.env.floci') -f (Join-Path $PSScriptRoot 'compose.yaml') up -d --wait
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not start Floci. Open Docker Desktop, wait until its engine is running, and run this command again.'
    }
}
$demoArguments = @('--env-file=.env', 'scripts/persistent-demo.js')
if ($Stop) { $demoArguments += '--stop' }
if ($NoOpen) { $demoArguments += '--no-open' }
Push-Location -LiteralPath $servicePath
try {
    & node @demoArguments
    $testExitCode = $LASTEXITCODE
} finally {
    Pop-Location
}
if ($testExitCode -ne 0) {
    throw "The local demo failed with exit code $testExitCode."
}
