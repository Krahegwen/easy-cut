# Genera el instalador de Windows (NSIS) firmado para el actualizador, sin dejar rutas de esta maquina
# dentro del ejecutable. Lo usan tanto `pnpm build-release` en local como el workflow de release.
#
# - Rutas: Rust guarda las rutas de compilacion en los mensajes de panico; --remap-path-prefix las sustituye,
#   para que el binario publicado no lleve el nombre de usuario ni la carpeta del repo.
# - Firma: con createUpdaterArtifacts, Tauri firma el instalador (.sig) con TAURI_SIGNING_PRIVATE_KEY. Si la
#   variable no esta definida, se lee la clave de %USERPROFILE%\.tauri\easy-cut.key (sin contrasena). La clave
#   nunca se imprime ni se copia al repo.
#
# Uso (desde la raiz del repo):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-release.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-release.ps1 -Config ruta\a\config.json
# (-Config: configuracion de Tauri que se mezcla con tauri.conf.json; solo para pruebas, p. ej. otro endpoint.)
# Fichero en ASCII puro a proposito: PowerShell 5.1 lee los .ps1 sin BOM como ANSI.

param(
    [string]$Config = ''
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    $env:PATH = "$env:PATH;$cargoBin"
}

# Clave de firma del actualizador.
if ([string]::IsNullOrEmpty($env:TAURI_SIGNING_PRIVATE_KEY)) {
    $keyFile = Join-Path $env:USERPROFILE '.tauri\easy-cut.key'
    if (-not (Test-Path -LiteralPath $keyFile)) {
        throw "Falta la clave para firmar las actualizaciones. Define la variable TAURI_SIGNING_PRIVATE_KEY o deja la clave en $keyFile (ver CLAUDE.md, apartado 'Actualizaciones')."
    }
    $env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content -LiteralPath $keyFile -Raw).Trim()
    Write-Host "Firmando con la clave de $keyFile"
} else {
    Write-Host 'Firmando con la clave de TAURI_SIGNING_PRIVATE_KEY'
}
if ($null -eq $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ''
}

# Sin la barra final: si no, el prefijo no casa con las rutas que guarda rustc.
$userRoot = $env:USERPROFILE.TrimEnd('\')
$repoPath = $repoRoot.TrimEnd('\')
$env:RUSTFLAGS = "--remap-path-prefix=$userRoot=~ --remap-path-prefix=$repoPath=easy-cut"

Set-Location $repoRoot
$tauriArgs = @('tauri', 'build')
if ($Config -ne '') { $tauriArgs += @('--config', $Config) }
& pnpm @tauriArgs
if ($LASTEXITCODE -ne 0) {
    throw "pnpm tauri build ha fallado ($LASTEXITCODE)"
}

Get-ChildItem (Join-Path $repoRoot 'src-tauri\target\release\bundle\nsis') |
    Where-Object { $_.Name -like '*.exe' -or $_.Name -like '*.sig' } |
    ForEach-Object { '{0}  ({1:N1} MB)' -f $_.FullName, ($_.Length / 1MB) }
