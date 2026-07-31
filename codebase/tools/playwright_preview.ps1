param(
    [string]$Url = "http://127.0.0.1:8000",
    [string]$ScreenshotPath = "",
    [string]$InputPath = "",
    [string]$SourceReportPath = "",
    [int]$ViewportWidth = 1440,
    [int]$ViewportHeight = 1000,
    [switch]$Headed,
    [switch]$KeepServer
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$OutputDir = Join-Path $Root "output\playwright"
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (-not $ScreenshotPath) {
    $ScreenshotPath = Join-Path $OutputDir "hdr-finisher-ui.png"
}

function Get-BaseUri {
    param([string]$TargetUrl)
    $uri = [Uri]$TargetUrl
    return "$($uri.Scheme)://$($uri.Authority)"
}

function Test-AppHealth {
    param([string]$BaseUri)
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "$BaseUri/health" -TimeoutSec 2
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Find-CachedPlaywrightNodeModules {
    $npxCache = Join-Path $env:LOCALAPPDATA "npm-cache\_npx"
    if (-not (Test-Path $npxCache)) {
        return $null
    }

    $package = Get-ChildItem -Recurse -Filter package.json -Path $npxCache -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -like "*\node_modules\playwright\package.json" } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if ($null -eq $package) {
        return $null
    }

    return Split-Path (Split-Path $package.FullName -Parent) -Parent
}

$baseUri = Get-BaseUri $Url
$serverStarted = $false
$serverProcess = $null

if (-not (Test-AppHealth $baseUri)) {
    $venvPython = Join-Path $Root ".venv\Scripts\python.exe"
    $pythonPath = if (Test-Path -LiteralPath $venvPython) {
        $venvPython
    } else {
        (Get-Command python -ErrorAction Stop).Source
    }
    $stderr = Join-Path $OutputDir "server.stderr.log"
    $processInfo = New-Object System.Diagnostics.ProcessStartInfo
    $processInfo.FileName = $pythonPath
    $processInfo.Arguments = "run_app.py"
    $processInfo.WorkingDirectory = $Root
    $processInfo.UseShellExecute = $false
    $processInfo.CreateNoWindow = $true
    $processInfo.RedirectStandardError = $true
    $serverProcess = New-Object System.Diagnostics.Process
    $serverProcess.StartInfo = $processInfo
    $previousPort = $env:HDR_FINISHER_PORT
    $env:HDR_FINISHER_PORT = ([Uri]$Url).Port.ToString()
    try {
        $null = $serverProcess.Start()
    } finally {
        $env:HDR_FINISHER_PORT = $previousPort
    }
    $serverStarted = $true

    $ready = $false
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 500
        if (Test-AppHealth $baseUri) {
            $ready = $true
            break
        }
        if ($serverProcess.HasExited) {
            $serverProcess.StandardError.ReadToEnd() | Set-Content -LiteralPath $stderr
            throw "HDR Finisher server exited early. See $stderr"
        }
    }
    if (-not $ready) {
        if (-not $serverProcess.HasExited) {
            Stop-Process -Id $serverProcess.Id -Force
        }
        throw "HDR Finisher server did not become healthy at $baseUri. See $stderr"
    }
}

$browserCache = Join-Path $env:LOCALAPPDATA "ms-playwright"
if (Test-Path $browserCache) {
    $env:PLAYWRIGHT_BROWSERS_PATH = $browserCache
}

$nodeModules = Find-CachedPlaywrightNodeModules
if ($nodeModules) {
    $env:NODE_PATH = $nodeModules
}

$script = Join-Path $PSScriptRoot "playwright_preview.js"
$nodeArgs = @(
    $script,
    "--url", $Url,
    "--screenshot", $ScreenshotPath,
    "--result", (Join-Path $OutputDir "preview-result.json"),
    "--export-screenshot", (Join-Path $Root "output\design-qa\export-sheet.png"),
    "--viewport-width", $ViewportWidth,
    "--viewport-height", $ViewportHeight
)
if ($InputPath) {
    $nodeArgs += @("--input", (Resolve-Path $InputPath))
}
if ($SourceReportPath) {
    $nodeArgs += @(
        "--source-report", (Resolve-Path $SourceReportPath),
        "--source-screenshot", (Join-Path $Root "output\design-qa\source-wireframe.png"),
        "--comparison-screenshot", (Join-Path $Root "output\design-qa\comparison.png")
    )
}
if ($Headed) {
    $nodeArgs += "--headed"
}

try {
    $exitCode = 0
    if ($nodeModules) {
        $node = Get-Command node -ErrorAction Stop
        & $node.Source @nodeArgs
        $exitCode = $LASTEXITCODE
    } else {
        $npx = Get-Command npx.cmd -ErrorAction Stop
        $npxArgs = @("--yes", "--package", "playwright", "node") + $nodeArgs
        & $npx.Source @npxArgs
        $exitCode = $LASTEXITCODE
    }
} finally {
    if ($serverStarted -and -not $KeepServer -and $serverProcess -and -not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id -Force
    }
}

if ($exitCode -ne 0) {
    exit $exitCode
}
