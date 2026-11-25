# Genera el instalador de Windows (NSIS) sin dejar rutas de esta maquina dentro del ejecutable.
# Rust guarda las rutas de compilacion en los mensajes de panico; --remap-path-prefix las sustituye,
# para que el binario publicado no lleve el nombre de usuario ni la carpeta del repo.
# Uso (desde la raiz del repo):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-release.ps1
# Fichero en ASCII puro a proposito: PowerShell 5.1 lee los .ps1 sin BOM como ANSI.

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    $env:PATH = "$env:PATH;$cargoBin"
}

$env:RUSTFLAGS = "--remap-path-prefix=$($env:USERPROFILE)=~ --remap-path-prefix=$repoRoot=easy-cut"

Set-Location $repoRoot
pnpm tauri build
if ($LASTEXITCODE -ne 0) {
    throw "pnpm tauri build ha fallado ($LASTEXITCODE)"
}

Get-ChildItem (Join-Path $repoRoot 'src-tauri\target\release\bundle\nsis') -Filter '*.exe' |
    ForEach-Object { '{0}  ({1:N1} MB)' -f $_.FullName, ($_.Length / 1MB) }
