# Sets up the PostgreSQL that PressGO's database tests use. No installer, no administrator rights, no system changes:
# it downloads EDB's official zip of PostgreSQL 17.11 for Windows, checks the size, and unpacks it into C:\PressGO-Tools.
# Run it by double-clicking SETUP-POSTGRES.cmd. Add -DryRun to see what it WOULD do without downloading anything.
param([switch]$DryRun)
$ErrorActionPreference = 'Stop'
$Url = 'https://get.enterprisedb.com/postgresql/postgresql-17.11-5-windows-x64-binaries.zip'
$ExpectedBytes = 381531864          # size EDB's server reported on 2026-10-21
$Root = 'C:\PressGO-Tools'
$Zip = Join-Path $Root 'downloads\postgresql-17.11-5-windows-x64-binaries.zip'
$Target = Join-Path $Root 'postgresql-17.11'
$Psql = Join-Path $Target 'pgsql\bin\psql.exe'

if (Test-Path $Psql) { Write-Host "Already set up: $Psql"; & $Psql --version; exit 0 }
Write-Host "Will download: $Url"
Write-Host ("Expected size: {0:N0} bytes (about {1:N0} MB)" -f $ExpectedBytes, ($ExpectedBytes / 1MB))
Write-Host "Will unpack into: $Target (about 1 GB). Nothing else on this computer is changed."
if ($DryRun) { Write-Host 'Dry run: nothing downloaded or changed.'; exit 0 }
if ((Get-PSDrive C).Free -lt 3GB) { throw 'Less than 3 GB free on C:. Free some space and run this again.' }

New-Item -ItemType Directory -Force -Path (Split-Path $Zip) | Out-Null
if (-not (Test-Path $Zip)) { & curl.exe -fL --retry 2 -o $Zip $Url; if ($LASTEXITCODE -ne 0) { throw 'The download failed.' } }
$size = (Get-Item $Zip).Length
if ($size -ne $ExpectedBytes) { throw "The downloaded file is $size bytes, not $ExpectedBytes. It was left at $Zip for you to inspect; nothing was unpacked." }
Write-Host ('SHA-256 of the download (for your records): ' + (Get-FileHash $Zip -Algorithm SHA256).Hash.ToLower())
Expand-Archive -LiteralPath $Zip -DestinationPath $Target
if (-not (Test-Path $Psql)) { throw "Unpacked, but $Psql is missing." }
& $Psql --version
Write-Host 'Done. Now double-click RUN-TESTS.cmd.'
