param([switch]$Migrate)
$ErrorActionPreference='Stop'
$PSNativeCommandUseErrorActionPreference=$true
$project=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$profile=Join-Path $project 'profile-api'
$secretsPath=Join-Path $PSScriptRoot '.env.floci'
$compose=@('compose','--env-file',$secretsPath,'-f',(Join-Path $PSScriptRoot 'compose.yaml'))
if (-not (Test-Path -LiteralPath $secretsPath)) { throw 'See infra/floci/README.md to initialize local Docker settings.' }
docker info --format 'Docker server {{.ServerVersion}}'
docker @compose up -d --wait --wait-timeout 120
Invoke-WebRequest 'http://127.0.0.1:4566/_floci/health' -NoProxy -TimeoutSec 5 | Out-Null
if ($Migrate) {
 Push-Location -LiteralPath $profile
 try { node --env-file=.env db/migrate.js } finally { Pop-Location }
}
$tempRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$build=Join-Path $tempRoot ('alumnilink-profile-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $build 'profile-api') -Force | Out-Null
try {
 $bundle=Join-Path $build 'profile-api'
 $files=@('app.js','profile-auth.js','errors.js','lambda.js','runtime.js','store.js','validation.js','service-client.js','package.json','package-lock.json')
 foreach($name in $files) { Copy-Item -LiteralPath (Join-Path $profile $name) -Destination $bundle }
 Push-Location -LiteralPath $bundle
 try { npm.cmd ci --omit=dev --ignore-scripts --no-audit --no-fund } finally { Pop-Location }
 $archive=Join-Path $build 'accounts.zip'
 Push-Location -LiteralPath $build
 try { tar.exe -a -cf $archive -- profile-api } finally { Pop-Location }
 docker @compose cp $archive 'floci:/tmp/alumnilink-accounts.zip'
 docker @compose cp (Join-Path $PSScriptRoot 'deploy.py') 'floci:/tmp/alumnilink-deploy.py'
 docker @compose cp (Join-Path $project 'frontend') 'floci:/tmp/alumnilink-frontend'
 $configScript=@'
const {parseEnv}=require('node:util');
const {readFileSync}=require('node:fs');
const env={...process.env,...parseEnv(readFileSync(process.argv[2],'utf8'))};
const names=['DATABASE_URL','JWT_PUBLIC_KEY','JWT_ISSUER','JWT_AUDIENCE','ADMIN_API_URL','SEARCH_API_URL','PROFILE_TO_ADMIN_TOKEN','PROFILE_TO_SEARCH_TOKEN','SEARCH_TO_PROFILE_TOKEN'];
const config=Object.fromEntries(names.filter(name=>env[name]).map(name=>[name,env[name]]));
if(!config.DATABASE_URL) throw new Error('Configure DATABASE_URL.');
config.FRONTEND_ORIGIN='http://localhost:4566';
process.stdout.write(JSON.stringify(config));
'@
 $settings=$configScript | node - (Join-Path $profile '.env')
 $settings | docker @compose exec -T floci python3 /tmp/alumnilink-deploy.py
} finally {
 $folder=Get-Item -LiteralPath $build -Force
 if ($folder.Parent.FullName.TrimEnd('\') -ieq $tempRoot.TrimEnd('\') -and $folder.Name -like 'alumnilink-profile-*' -and -not $folder.LinkType) {
  Remove-Item -LiteralPath $folder.FullName -Recurse -Force
 }
}
