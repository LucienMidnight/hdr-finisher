param(
    [switch]$SkipTests,
    [switch]$SkipPlaywright,
    [int]$SmokeTestPort = 8011
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$PackageDir = Join-Path $Root "output\package"
$DistDir = Join-Path $PackageDir "dist"
$WorkDir = Join-Path $PackageDir "build"
$ZipPath = Join-Path $PackageDir "HDRFinisher-alpha-windows.zip"
$QaScript = Join-Path $PSScriptRoot "run_alpha_qa.ps1"

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
    python -c "import PyInstaller" 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "PyInstaller is not installed. Run: python -m pip install -r requirements-dev.txt"
    }

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

    New-Item -ItemType Directory -Force -Path $PackageDir | Out-Null
    if (Test-Path $DistDir) {
        Remove-Item -LiteralPath $DistDir -Recurse -Force
    }
    if (Test-Path $WorkDir) {
        Remove-Item -LiteralPath $WorkDir -Recurse -Force
    }
    if (Test-Path $ZipPath) {
        Remove-Item -LiteralPath $ZipPath -Force
    }

    python -m PyInstaller `
        --noconfirm `
        --clean `
        --distpath $DistDir `
        --workpath $WorkDir `
        "HDRFinisher.spec"

    if ($LASTEXITCODE -ne 0) {
        throw "PyInstaller build failed."
    }

    $exePath = Join-Path $DistDir "HDRFinisher\HDRFinisher.exe"
    if (-not (Test-Path $exePath)) {
        throw "Expected packaged executable not found: $exePath"
    }
    $smokeBaseUri = "http://127.0.0.1:$SmokeTestPort"
    if (Test-Health $smokeBaseUri) {
        throw "Port $SmokeTestPort is already serving /health before the packaged smoke test. Choose another -SmokeTestPort."
    }

    $previousPort = $env:HDR_FINISHER_PORT
    $env:HDR_FINISHER_PORT = $SmokeTestPort.ToString()
    try {
        $process = Start-PackagedApp $exePath
    } finally {
        $env:HDR_FINISHER_PORT = $previousPort
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

    Compress-Archive -LiteralPath (Join-Path $DistDir "HDRFinisher") -DestinationPath $ZipPath -Force
    Write-Host "Windows alpha package written to $ZipPath"
} finally {
    Pop-Location
}
