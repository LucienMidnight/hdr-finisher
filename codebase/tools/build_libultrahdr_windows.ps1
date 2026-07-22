param(
    [string]$Commit = "ad4a92eea0d2f39f18b5ecae3165fdd56c6a478b",
    [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$WorkRoot = Join-Path $Root "output\libultrahdr-build"
$SourceDir = Join-Path $WorkRoot "source"
$BuildDir = Join-Path $WorkRoot "build"
$BinDir = Join-Path $Root "bin"
$LicenseDir = Join-Path $BinDir "licenses"

function Invoke-CheckedCommand {
    param([string]$FilePath, [string[]]$Arguments)
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
    }
}

$git = (Get-Command git -ErrorAction Stop).Source
$cmake = (Get-Command cmake -ErrorAction Stop).Source
New-Item -ItemType Directory -Force -Path $WorkRoot, $BinDir, $LicenseDir | Out-Null

if (-not (Test-Path (Join-Path $SourceDir ".git"))) {
    Invoke-CheckedCommand $git @("clone", "https://github.com/google/libultrahdr.git", $SourceDir)
}

Invoke-CheckedCommand $git @("-C", $SourceDir, "fetch", "--depth", "1", "origin", $Commit)
Invoke-CheckedCommand $git @("-C", $SourceDir, "checkout", "--detach", $Commit)

$configureArgs = @(
    "-S", $SourceDir,
    "-B", $BuildDir,
    "-A", "x64",
    "-DCMAKE_BUILD_TYPE=Release",
    "-DBUILD_SHARED_LIBS=OFF",
    "-DUHDR_BUILD_DEPS=ON",
    "-DUHDR_BUILD_EXAMPLES=ON",
    "-DUHDR_BUILD_TESTS=ON",
    "-DUHDR_WRITE_XMP=ON",
    "-DUHDR_WRITE_ISO=ON"
)
Invoke-CheckedCommand $cmake $configureArgs
Invoke-CheckedCommand $cmake @("--build", $BuildDir, "--config", "Release", "--parallel")

if (-not $SkipTests) {
    Invoke-CheckedCommand "ctest" @("--test-dir", $BuildDir, "-C", "Release", "--output-on-failure")
}

$encoder = Get-ChildItem -Path $BuildDir -Recurse -Filter "ultrahdr_app.exe" |
    Where-Object { $_.FullName -match "Release" } |
    Select-Object -First 1
if ($null -eq $encoder) {
    $encoder = Get-ChildItem -Path $BuildDir -Recurse -Filter "ultrahdr_app.exe" | Select-Object -First 1
}
if ($null -eq $encoder) {
    throw "The build completed without producing ultrahdr_app.exe."
}

Copy-Item -LiteralPath $encoder.FullName -Destination (Join-Path $BinDir "ultrahdr_app.exe") -Force
Copy-Item -LiteralPath (Join-Path $SourceDir "LICENSE") -Destination (Join-Path $LicenseDir "libultrahdr-LICENSE.txt") -Force
Copy-Item -LiteralPath (Join-Path $SourceDir "LICENSE-APACHE") -Destination (Join-Path $LicenseDir "libultrahdr-LICENSE-APACHE.txt") -Force
Copy-Item -LiteralPath (Join-Path $SourceDir "LICENSE-MIT") -Destination (Join-Path $LicenseDir "libultrahdr-LICENSE-MIT.txt") -Force
Copy-Item -LiteralPath (Join-Path $SourceDir "adobe-hdr-gain-map-license\NOTICE") -Destination (Join-Path $LicenseDir "adobe-hdr-gain-map-NOTICE.txt") -Force

$jpegLicense = Get-ChildItem -Path $BuildDir -Recurse -Filter "LICENSE.md" |
    Where-Object { $_.FullName -match "libjpeg" } |
    Select-Object -First 1
if ($jpegLicense) {
    Copy-Item -LiteralPath $jpegLicense.FullName -Destination (Join-Path $LicenseDir "libjpeg-turbo-LICENSE.md") -Force
}

Push-Location $Root
try {
    Invoke-CheckedCommand "python" @(
        "tools\generate_ultrahdr_reference.py",
        "--output", (Join-Path $WorkRoot "build-validation.jpg"),
        "--json", (Join-Path $WorkRoot "build-validation.json")
    )
} finally {
    Pop-Location
}

Write-Host "Pinned libultrahdr $Commit built and validated at $(Join-Path $BinDir 'ultrahdr_app.exe')"
