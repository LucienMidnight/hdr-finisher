param(
    [switch]$SkipTests,
    [switch]$SkipPlaywright,
    [int]$SmokeTestPort = 8011
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$OutputRoot = [IO.Path]::GetFullPath((Join-Path $Root "output"))
$PackageDir = [IO.Path]::GetFullPath((Join-Path $OutputRoot "package"))
$StagingDir = Join-Path $PackageDir "staging"
$DistDir = Join-Path $StagingDir "dist"
$WorkDir = Join-Path $StagingDir "build"
$QaScript = Join-Path $PSScriptRoot "run_alpha_qa.ps1"
$VenvPython = Join-Path $Root ".venv\Scripts\python.exe"
$Python = if (Test-Path -LiteralPath $VenvPython) {
    $VenvPython
} else {
    (Get-Command python -ErrorAction Stop).Source
}

$expectedPrefix = $OutputRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not $PackageDir.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to clean package path outside the output directory: $PackageDir"
}

function Test-Health {
    param([string]$BaseUri)
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "$BaseUri/health" -TimeoutSec 2
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Start-PackagedApp {
    param([string]$ExePath)
    $processInfo = New-Object System.Diagnostics.ProcessStartInfo
    $processInfo.FileName = $ExePath
    $processInfo.WorkingDirectory = Split-Path $ExePath -Parent
    $processInfo.UseShellExecute = $false
    $processInfo.CreateNoWindow = $true
    $processInfo.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $processInfo
    $null = $process.Start()
    return $process
}

Push-Location $Root
try {
    & $Python -c "import PyInstaller"
    if ($LASTEXITCODE -ne 0) {
        throw "PyInstaller is not installed. Run: python -m pip install -r requirements-dev.txt"
    }

    $Version = (& $Python -c "import sys; sys.path.insert(0, 'backend'); from hdr_finisher.config import APP_VERSION; print(APP_VERSION)").Trim()
    if ($LASTEXITCODE -ne 0 -or -not $Version) {
        throw "Could not read the HDR Finisher version."
    }

    $ReleaseStem = "HDR-Finisher-v$Version-Windows-x64"
    $ZipPath = Join-Path $PackageDir "$ReleaseStem.zip"
    $ChecksumPath = "$ZipPath.sha256"

    if (-not $SkipTests) {
        $qaArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $QaScript)
        if ($SkipPlaywright) {
            $qaArgs += "-SkipPlaywright"
        }
        & powershell @qaArgs
        if ($LASTEXITCODE -ne 0) {
            throw "Alpha QA command failed."
        }
    }

    # This directory contains generated packages only. Recreate it so stale
    # executables can never survive beside a newer release artifact.
    if (Test-Path -LiteralPath $PackageDir) {
        Remove-Item -LiteralPath $PackageDir -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $StagingDir | Out-Null

    & $Python -m PyInstaller `
        --noconfirm `
        --clean `
        --distpath $DistDir `
        --workpath $WorkDir `
        "HDRFinisher.spec"

    if ($LASTEXITCODE -ne 0) {
        throw "PyInstaller build failed."
    }

    $BundleDir = Join-Path $DistDir "HDR Finisher"
    $ExePath = Join-Path $BundleDir "HDR Finisher.exe"
    if (-not (Test-Path -LiteralPath $ExePath)) {
        throw "Expected packaged executable not found: $ExePath"
    }

    $smokeBaseUri = "http://127.0.0.1:$SmokeTestPort"
    if (Test-Health $smokeBaseUri) {
        throw "Port $SmokeTestPort is already serving /health before the packaged smoke test. Choose another -SmokeTestPort."
    }

    $previousPort = $env:HDR_FINISHER_PORT
    $previousNoBrowser = $env:HDR_FINISHER_NO_BROWSER
    $env:HDR_FINISHER_PORT = $SmokeTestPort.ToString()
    $env:HDR_FINISHER_NO_BROWSER = "1"
    try {
        $process = Start-PackagedApp $ExePath
    } finally {
        $env:HDR_FINISHER_PORT = $previousPort
        $env:HDR_FINISHER_NO_BROWSER = $previousNoBrowser
    }
    try {
        $ready = $false
        for ($i = 0; $i -lt 40; $i++) {
            Start-Sleep -Milliseconds 500
            if ($process.HasExited) {
                throw "Packaged app exited early: $($process.StandardError.ReadToEnd())"
            }
            if (Test-Health $smokeBaseUri) {
                $ready = $true
                break
            }
        }
        if (-not $ready) {
            throw "Packaged app did not become healthy on $smokeBaseUri"
        }
    } finally {
        if ($process -and -not $process.HasExited) {
            Stop-Process -Id $process.Id -Force
        }
    }

    Compress-Archive -Path (Join-Path $BundleDir "*") -DestinationPath $ZipPath -Force
    $checksum = Get-FileHash -Algorithm SHA256 -LiteralPath $ZipPath
    "{0}  {1}" -f $checksum.Hash.ToLowerInvariant(), (Split-Path $ZipPath -Leaf) |
        Set-Content -LiteralPath $ChecksumPath -Encoding ascii -NoNewline

    Remove-Item -LiteralPath $StagingDir -Recurse -Force
    Write-Host "Windows release package: $ZipPath"
    Write-Host "SHA-256 checksum:       $ChecksumPath"
} finally {
    if (Test-Path -LiteralPath $StagingDir) {
        Remove-Item -LiteralPath $StagingDir -Recurse -Force
    }
    Pop-Location
}
