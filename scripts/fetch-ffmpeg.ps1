# Deja ffmpeg y ffprobe en src-tauri/binaries/ con el sufijo del target triple, que es como Tauri espera los
# sidecars (externalBin). Los binarios no se commitean.
#
# Dos modos:
#   - Sin opciones: copia los del PATH (para desarrollar con el ffmpeg que ya haya en el PC).
#   - -Download: descarga la compilacion fijada en scripts/ffmpeg-build.json, comprueba su SHA-256 y extrae
#     los dos ejecutables. Es lo que usa el workflow de release, asi local y CI empaquetan el mismo ffmpeg.
#
# Uso (desde la raiz del repo):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\fetch-ffmpeg.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\fetch-ffmpeg.ps1 -Download
# Fichero en ASCII puro a proposito: PowerShell 5.1 lee los .ps1 sin BOM como ANSI.

param(
    # Target triple de Rust; por defecto, el host de rustc (o x86_64-pc-windows-msvc si no hay rustc).
    [string]$Target = '',
    # Descargar la compilacion fijada en lugar de copiar la del PATH.
    [switch]$Download,
    # Carpeta donde se guarda el zip descargado (se reutiliza si el hash coincide). Por defecto, en TEMP.
    [string]$CacheDir = ''
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

function Get-Sha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

if ($Download) {
    $buildFile = Join-Path $PSScriptRoot 'ffmpeg-build.json'
    $build = Get-Content -LiteralPath $buildFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $expected = $build.sha256.ToLowerInvariant()

    if ($CacheDir -eq '') { $CacheDir = Join-Path ([System.IO.Path]::GetTempPath()) 'easy-cut-ffmpeg' }
    if (-not (Test-Path -LiteralPath $CacheDir)) {
        New-Item -ItemType Directory -Path $CacheDir | Out-Null
    }
    $zipPath = Join-Path $CacheDir $build.asset

    $haveZip = $false
    if (Test-Path -LiteralPath $zipPath) {
        $haveZip = ((Get-Sha256 $zipPath) -eq $expected)
        if (-not $haveZip) { Remove-Item -LiteralPath $zipPath -Force }
    }
    if ($haveZip) {
        Write-Host "Zip de ffmpeg ya descargado y con el hash correcto: $zipPath"
    } else {
        Write-Host "Descargando $($build.url)"
        $partial = "$zipPath.part"
        # Sin barra de progreso: en PowerShell 5.1 la descarga va muchisimo mas lenta con ella.
        $oldProgress = $ProgressPreference
        $ProgressPreference = 'SilentlyContinue'
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -Uri $build.url -OutFile $partial -UseBasicParsing
        } finally {
            $ProgressPreference = $oldProgress
        }
        $actual = Get-Sha256 $partial
        if ($actual -ne $expected) {
            Remove-Item -LiteralPath $partial -Force
            throw "El SHA-256 del ffmpeg descargado no coincide con scripts/ffmpeg-build.json (esperado $expected, recibido $actual). No se usa."
        }
        Move-Item -LiteralPath $partial -Destination $zipPath -Force
        Write-Host "SHA-256 correcto: $actual"
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        foreach ($tool in @('ffmpeg', 'ffprobe')) {
            $entry = $zip.Entries | Where-Object { $_.FullName -match "/bin/$tool\.exe$" } | Select-Object -First 1
            if ($null -eq $entry) { throw "El zip no tiene bin/$tool.exe" }
            $dest = Join-Path $destDir "$tool-$Target.exe"
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $dest, $true)
            Write-Host "$tool extraido: $dest"
            $version = & $dest -hide_banner -version | Select-Object -First 1
            Write-Host "  $version"
            if ($version -notlike "*$($build.version)*") {
                throw "$tool dice '$version', pero scripts/ffmpeg-build.json espera la version $($build.version)."
            }
        }
    } finally {
        $zip.Dispose()
    }
    return
}

foreach ($tool in @('ffmpeg', 'ffprobe')) {
    $cmd = Get-Command "$tool.exe" -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $cmd) {
        throw "No se encuentra $tool en el PATH. Instala ffmpeg (por ejemplo, la build GPL de BtbN) o usa -Download para bajar la compilacion fijada."
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
