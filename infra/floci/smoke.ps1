$ErrorActionPreference = 'Stop'
$servicePath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\profile-api')).Path
$testExitCode = 0

Push-Location -LiteralPath $servicePath
try {
    & node --env-file=.env scripts/deployed-check.js
    $testExitCode = $LASTEXITCODE
} finally {
    Pop-Location
}

if ($testExitCode -ne 0) {
    throw "The deployed smoke test failed with exit code $testExitCode."
}
