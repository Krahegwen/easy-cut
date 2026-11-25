# Copia ffmpeg y ffprobe desde el PATH a src-tauri/binaries/ con el sufijo del target triple,
# que es como Tauri espera los sidecars (externalBin). Los binarios no se commitean.
# Uso (desde la raiz del repo):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\fetch-ffmpeg.ps1
# Fichero en ASCII puro a proposito: PowerShell 5.1 lee los .ps1 sin BOM como ANSI.

param(
    # Target triple de Rust; por defecto, el host de rustc (o x86_64-pc-windows-msvc si no hay rustc).
    [string]$Target = ''
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$destDir = Join-Path $repoRoot 'src-tauri\binaries'

if ($Target -eq '') {
    $rustc = Get-Command rustc -ErrorAction SilentlyContinue
    if ($null -eq $rustc) {
        $cargoRustc = Join-Path $env:USERPROFILE '.cargo\bin\rustc.exe'
        if (Test-Path -LiteralPath $cargoRustc) { $rustc = Get-Command $cargoRustc }
    }
    if ($null -ne $rustc) {
        $hostLine = & $rustc.Source -vV | Where-Object { $_ -like 'host:*' }
        if ($hostLine) { $Target = ($hostLine -replace '^host:\s*', '').Trim() }
    }
    if ($Target -eq '') { $Target = 'x86_64-pc-windows-msvc' }
}

if (-not (Test-Path -LiteralPath $destDir)) {
    New-Item -ItemType Directory -Path $destDir | Out-Null
}

foreach ($tool in @('ffmpeg', 'ffprobe')) {
    $cmd = Get-Command "$tool.exe" -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $cmd) {
        throw "No se encuentra $tool en el PATH. Instala ffmpeg (por ejemplo, la build GPL de BtbN) y vuelve a ejecutar el script."
    }
    $source = Get-Item -LiteralPath $cmd.Source
    $dest = Join-Path $destDir "$tool-$Target.exe"

    $upToDate = $false
    if (Test-Path -LiteralPath $dest) {
        $current = Get-Item -LiteralPath $dest
        $upToDate = ($current.Length -eq $source.Length) -and ($current.LastWriteTimeUtc -eq $source.LastWriteTimeUtc)
    }

    if ($upToDate) {
        Write-Host "$tool ya esta al dia: $dest"
    } else {
        Copy-Item -LiteralPath $source.FullName -Destination $dest -Force
        Write-Host "$tool copiado: $($source.FullName) -> $dest"
    }

    # Comprobacion: el binario copiado arranca y dice su version.
    $version = & $dest -hide_banner -version | Select-Object -First 1
    Write-Host "  $version"
}

# Aviso si la build no es estatica (las DLL no se copiarian y el sidecar no arrancaria en otro PC).
$ffmpegDir = Split-Path -Parent (Get-Command 'ffmpeg.exe' -CommandType Application | Select-Object -First 1).Source
$dlls = Get-ChildItem -LiteralPath $ffmpegDir -Filter '*.dll' -ErrorAction SilentlyContinue
if ($dlls) {
    Write-Warning "La carpeta de ffmpeg tiene DLL ($($dlls.Count)): parece una build 'shared'. Usa una build estatica para empaquetarla."
}
