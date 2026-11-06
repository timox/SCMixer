<#
.SYNOPSIS
  Publie une release GitHub de SCMixer : release.ps1 -Version X.Y.Z

.DESCRIPTION
  1. Vérifie : branche main, arbre de travail propre, main à jour avec origin, étiquette vX.Y.Z inexistante.
  2. Exécute les tests du moteur (npm test) et de l'interface (ctest).
  3. Construit l'installateur (build-installer.ps1 -Version X.Y.Z).
  4. Crée l'étiquette vX.Y.Z, la pousse, puis crée la release GitHub avec SCMixer-X.Y.Z-Setup.exe (gh).
  Une étape en échec arrête le script avant toute étiquette ou publication.
#>
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,
    [string]$Notes = ''
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$tag = "v$Version"

function Run($exe, [string[]]$arguments, $where = $root) {
    Push-Location $where
    try {
        & $exe @arguments
        if ($LASTEXITCODE -ne 0) { throw "Échec ($LASTEXITCODE) : $exe $($arguments -join ' ')" }
    } finally { Pop-Location }
}
function Out($exe, [string[]]$arguments) {
    Push-Location $root
    try { (& $exe @arguments | Out-String).Trim() } finally { Pop-Location }
}

$null = Get-Command git, gh, node, npm
if ((Out git @('branch', '--show-current')) -ne 'main') { throw 'La release se fait depuis la branche main.' }
if ((Out git @('status', '--porcelain')) -ne '') { throw 'Arbre de travail non propre : committer ou retirer les modifications.' }
Run git @('fetch', 'origin', 'main', '--tags')
if ((Out git @('rev-parse', 'HEAD')) -ne (Out git @('rev-parse', 'origin/main'))) { throw 'main diffère de origin/main : pousser ou mettre à jour avant la release.' }
if ((Out git @('tag', '--list', $tag)) -ne '') { throw "L'étiquette $tag existe déjà." }

Write-Host '== Tests du moteur'
Run npm @('ci', '--no-audit', '--no-fund') (Join-Path $root 'engine')
Run npm @('test') (Join-Path $root 'engine')
Write-Host "== Tests de l'interface"
$env:PATH = "C:\Qt\6.12.0\mingw_64\bin;C:\Qt\Tools\mingw1310_64\bin;C:\Qt\Tools\CMake_64\bin;C:\Qt\Tools\Ninja;$env:PATH"
$desktop = Join-Path $root 'desktop'
Run cmake @('--preset', 'mingw') $desktop
Run cmake @('--build', '--preset', 'mingw') $desktop
Run ctest @('--preset', 'mingw') $desktop

Write-Host '== Installateur'
& (Join-Path $PSScriptRoot 'build-installer.ps1') -Version $Version
$setup = Join-Path $PSScriptRoot "dist\SCMixer-$Version-Setup.exe"
if (-not (Test-Path $setup)) { throw "Installateur absent : $setup" }

Write-Host "== Étiquette $tag et release GitHub"
Run git @('tag', '-a', $tag, '-m', "SCMixer $Version")
Run git @('push', 'origin', $tag)
if ($Notes -eq '') { $Notes = "SCMixer $Version. Prérequis : Node.js 22 ou plus récent, pilote ASIO TimoxVasio. SuperCollider 3.14.1 est embarqué (GPL v3)." }
Run gh @('release', 'create', $tag, $setup, '--title', "SCMixer $Version", '--notes', $Notes)
Write-Host "Release $tag publiée."
