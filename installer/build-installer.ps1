<#
.SYNOPSIS
  Construit l'installateur (Qt Installer Framework) : installer\dist\SCMixer-<Version>-Setup.exe.

.DESCRIPTION
  1. Interface : compilation Release (preset CMake « release »), puis windeployqt.
  2. Service moteur : copie de engine\ (sans les tests) et dépendances de production (npm ci --omit=dev).
  3. SuperCollider : copie de ce qu'il faut à sclang et scsynth (exécutables, DLL du dossier, plug-ins Qt
     chargés par sclang, SCClassLibrary, plug-ins de serveur, COPYING).
  4. binarycreator (hors ligne) avec installer\config et les paquets préparés dans installer\build.
  Les dossiers installer\build et installer\dist sont recréés à chaque exécution.
#>
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,
    [string]$ScDir = 'C:\Program Files\SuperCollider-3.14.1',
    [string]$QtDir = 'C:\Qt\6.12.0\mingw_64',
    [string]$QtTools = 'C:\Qt\Tools'
)
$ErrorActionPreference = 'Stop'

$here = $PSScriptRoot
$root = Split-Path $here -Parent
$stage = Join-Path $here 'build'
$dist = Join-Path $here 'dist'
$packages = Join-Path $stage 'packages'

function Step($text) { Write-Host "== $text" }
function Need($path, $what) { if (-not (Test-Path $path)) { throw "$what introuvable : $path" } }
function Run($exe, [string[]]$arguments, $where = $null) {
    if ($where) { Push-Location $where }
    try {
        & $exe @arguments
        if ($LASTEXITCODE -ne 0) { throw "Échec ($LASTEXITCODE) : $exe $($arguments -join ' ')" }
    } finally { if ($where) { Pop-Location } }
}

$binarycreator = Get-ChildItem (Join-Path $QtTools 'QtInstallerFramework') -Recurse -Filter binarycreator.exe -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1
if (-not $binarycreator) { throw "Qt Installer Framework introuvable sous $QtTools\QtInstallerFramework (l'installer avec C:\Qt\MaintenanceTool.exe)." }
Need (Join-Path $ScDir 'sclang.exe') 'sclang'
Need (Join-Path $ScDir 'scsynth.exe') 'scsynth'
Need (Join-Path $QtDir 'bin\windeployqt.exe') 'windeployqt'
$null = Get-Command node, npm

$env:PATH = "$QtDir\bin;$QtTools\mingw1310_64\bin;$QtTools\CMake_64\bin;$QtTools\Ninja;$env:PATH"

Step 'Préparation de installer\build'
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
Copy-Item (Join-Path $here 'packages') $packages -Recurse
Copy-Item (Join-Path $here 'config') (Join-Path $stage 'config') -Recurse
$xmlFiles = @(Join-Path $stage 'config\config.xml') + @(Get-ChildItem $packages -Recurse -Filter package.xml | ForEach-Object FullName)
foreach ($file in $xmlFiles) {
    $text = [IO.File]::ReadAllText($file)
    if ($file -notlike '*fr.scmixer.supercollider*') { $text = $text -replace '<Version>[^<]*</Version>', "<Version>$Version</Version>" }
    $text = $text -replace '<ReleaseDate>[^<]*</ReleaseDate>', ('<ReleaseDate>' + (Get-Date -Format 'yyyy-MM-dd') + '</ReleaseDate>')
    [IO.File]::WriteAllText($file, $text, (New-Object Text.UTF8Encoding $false))
}
New-Item -ItemType Directory -Force $dist | Out-Null
$desktopData = Join-Path $packages 'fr.scmixer.desktop\data'
$engineData = Join-Path $packages 'fr.scmixer.engine\data\engine'
$scData = Join-Path $packages 'fr.scmixer.supercollider\data\supercollider'

Step 'Interface : compilation Release et windeployqt'
$desktop = Join-Path $root 'desktop'
Run 'cmake' @('--preset', 'release') $desktop
Run 'cmake' @('--build', '--preset', 'release', '--target', 'scmixer') $desktop
$appDir = Join-Path $desktopData 'desktop'
New-Item -ItemType Directory -Force $appDir | Out-Null
Copy-Item (Join-Path $desktop 'build\release\scmixer.exe') $appDir
Run 'windeployqt' @('--release', '--qmldir', (Join-Path $desktop 'qml'), '--no-translations', '--compiler-runtime',
                    (Join-Path $appDir 'scmixer.exe'))
Copy-Item (Join-Path $here 'SCMixer.cmd') $desktopData

Step 'Service moteur : sources et dépendances de production'
$engine = Join-Path $root 'engine'
New-Item -ItemType Directory -Force $engineData | Out-Null
foreach ($item in 'src', 'sc', 'tools', 'package.json', 'package-lock.json', 'engine.cmd', 'openapi.yaml', 'README.md') {
    Copy-Item (Join-Path $engine $item) $engineData -Recurse
}
Run 'npm' @('ci', '--omit=dev', '--no-audit', '--no-fund') $engineData

Step "SuperCollider : copie depuis $ScDir"
New-Item -ItemType Directory -Force $scData | Out-Null
Copy-Item (Join-Path $ScDir 'sclang.exe'), (Join-Path $ScDir 'scsynth.exe'), (Join-Path $ScDir 'COPYING') $scData
Get-ChildItem $ScDir -Filter *.dll | Copy-Item -Destination $scData
# sclang est une application Qt : plug-ins Qt chargés au démarrage de l'interpréteur.
foreach ($dir in 'SCClassLibrary', 'plugins', 'platforms', 'styles', 'imageformats', 'iconengines', 'tls', 'networkinformation') {
    Copy-Item (Join-Path $ScDir $dir) $scData -Recurse
}

Step 'binarycreator'
$setup = Join-Path $dist "SCMixer-$Version-Setup.exe"
Run $binarycreator.FullName @('--offline-only', '-c', (Join-Path $stage 'config\config.xml'), '-p', $packages, $setup)
$size = (Get-Item $setup).Length / 1MB
Write-Host ("Installateur : {0} ({1:N1} Mo)" -f $setup, $size)
