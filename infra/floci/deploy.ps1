param([switch]$Migrate)
$ErrorActionPreference='Stop'
function Assert-NativeSuccess([string]$Step) {
 if ($LASTEXITCODE -ne 0) { throw "$Step failed (exit code $LASTEXITCODE)." }
}
$project=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$profile=Join-Path $project 'profile-api'
$secretsPath=Join-Path $PSScriptRoot '.env.floci'
$compose=@('compose','--env-file',$secretsPath,'-f',(Join-Path $PSScriptRoot 'compose.yaml'))
if (-not (Test-Path -LiteralPath $secretsPath)) { throw 'See infra/floci/README.md to initialize local Docker settings.' }
if (-not (Test-Path -LiteralPath (Join-Path $profile '.env'))) { throw 'Copy profile-api/.env.example to .env and configure DATABASE_URL.' }
docker info --format 'Docker server {{.ServerVersion}}'
Assert-NativeSuccess 'Docker server check'
docker @compose up -d --wait --wait-timeout 120
Assert-NativeSuccess 'Floci startup'
curl.exe --noproxy '*' --fail --silent --show-error --max-time 5 'http://127.0.0.1:4566/_floci/health' | Out-Null
Assert-NativeSuccess 'Floci health check'
if ($Migrate) {
 Push-Location -LiteralPath $profile
 try { node --env-file=.env db/migrate.js; Assert-NativeSuccess 'Profile migration' } finally { Pop-Location }
}
$tempRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$build=Join-Path $tempRoot ('alumnilink-profile-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $build 'profile-api') -Force | Out-Null
try {
 $bundle=Join-Path $build 'profile-api'
 $files=@(
  'app.js','errors.js','lambda.js','runtime.js','validation.js','package.json','package-lock.json',
  'controllers/internal.js','controllers/profiles.js',
  'middleware/activeAccount.js','middleware/auth.js',
  'routes/internal.js','routes/profiles.js',
  'services/db.js','services/profileStore.js','services/serviceClient.js','services/photoStore.js'
 )
 foreach ($name in $files) {
  $destination=Join-Path $bundle $name
  New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $profile $name) -Destination $destination
 }
 $sharedBundle=Join-Path $build 'shared'
 New-Item -ItemType Directory -Path $sharedBundle -Force | Out-Null
 foreach ($name in @('auth.js','errors.js')) { Copy-Item -LiteralPath (Join-Path $project ('shared/' + $name)) -Destination $sharedBundle }
 Push-Location -LiteralPath $bundle
 try { npm.cmd ci --omit=dev --ignore-scripts --no-audit --no-fund --os=linux --cpu=x64 --libc=glibc; Assert-NativeSuccess 'Profile dependency install' } finally { Pop-Location }
 $archive=Join-Path $build 'accounts.zip'
 Push-Location -LiteralPath $build
 try { tar.exe -a -cf $archive -- profile-api shared; Assert-NativeSuccess 'Lambda packaging' } finally { Pop-Location }
 docker @compose cp $archive 'floci:/tmp/alumnilink-accounts.zip'
 Assert-NativeSuccess 'Lambda bundle copy'
 docker @compose cp (Join-Path $PSScriptRoot 'deploy.py') 'floci:/tmp/alumnilink-deploy.py'
 Assert-NativeSuccess 'Deploy script copy'
 docker @compose cp (Join-Path $project 'frontend') 'floci:/tmp/alumnilink-frontend'
 Assert-NativeSuccess 'Frontend copy'
 $configScript=@'
const {parseEnv}=require('node:util');
const {readFileSync}=require('node:fs');
const env={...process.env,...parseEnv(readFileSync(process.argv[2],'utf8'))};
const names=['DATABASE_URL','TOKEN_SECRET','SERVICE_KEY','IDENTITY_API_URL','SEARCH_API_URL'];
const config=Object.fromEntries(names.filter(name=>env[name]).map(name=>[name,env[name]]));
if(!config.DATABASE_URL) throw new Error('Configure DATABASE_URL.');
config.FRONTEND_ORIGIN='http://localhost:4566';
process.stdout.write(JSON.stringify(config));
'@
 $settings=$configScript | node - (Join-Path $profile '.env')
 Assert-NativeSuccess 'Profile configuration'
 $settings | docker @compose exec -T floci python3 /tmp/alumnilink-deploy.py
 Assert-NativeSuccess 'Profile deployment'
} finally {
 $folder=Get-Item -LiteralPath $build -Force
 if ($folder.Parent.FullName.TrimEnd('\') -ieq $tempRoot.TrimEnd('\') -and $folder.Name -like 'alumnilink-profile-*' -and -not $folder.LinkType) {
  Remove-Item -LiteralPath $folder.FullName -Recurse -Force
 }
}
