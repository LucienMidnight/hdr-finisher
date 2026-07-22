param(
    [switch]$SkipPlaywright,
    [switch]$SkipSampleExport
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$QaDir = Join-Path $Root "output\qa"
New-Item -ItemType Directory -Force -Path $QaDir | Out-Null

$summary = [ordered]@{
    generated_at = (Get-Date).ToString("o")
    root = $Root.Path
    steps = @()
}

function Invoke-QaStep {
    param(
        [string]$Name,
        [scriptblock]$Block
    )

    $started = Get-Date
    $record = [ordered]@{
        name = $Name
        ok = $false
        duration_seconds = 0
        error = $null
    }
    try {
        & $Block
        $record.ok = $true
    } catch {
        $record.error = $_.Exception.Message
    }
    $record.duration_seconds = [Math]::Round(((Get-Date) - $started).TotalSeconds, 2)
    $summary.steps += $record
    if (-not $record.ok) {
        throw "QA step failed: $Name - $($record.error)"
    }
}

function Invoke-LoggedCommand {
    param(
        [string]$Name,
        [string]$FilePath,
        [string[]]$Arguments
    )

    $logPath = Join-Path $QaDir "$Name.log"
    $processInfo = New-Object System.Diagnostics.ProcessStartInfo
    $processInfo.FileName = $FilePath
    $processInfo.Arguments = Join-ProcessArguments $Arguments
    $processInfo.WorkingDirectory = $Root
    $processInfo.UseShellExecute = $false
    $processInfo.CreateNoWindow = $true
    $processInfo.RedirectStandardOutput = $true
    $processInfo.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $processInfo
    $null = $process.Start()
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    $stdout = $stdoutTask.Result
    $stderr = $stderrTask.Result

    @($stdout, $stderr) | Set-Content -LiteralPath $logPath
    if ($process.ExitCode -ne 0) {
        throw "$FilePath $($Arguments -join ' ') failed with exit code $($process.ExitCode). See $logPath"
    }
}

function Join-ProcessArguments {
    param([string[]]$Arguments)

    return (($Arguments | ForEach-Object {
        if ($_ -match '[\s"]') {
            '"' + ($_ -replace '"', '\"') + '"'
        } else {
            $_
        }
    }) -join " ")
}

Push-Location $Root
try {
    Invoke-QaStep "pytest" { Invoke-LoggedCommand "pytest" "python" @("-m", "pytest", "-q") }
    Invoke-QaStep "node-check" { Invoke-LoggedCommand "node-check" "node" @("--check", "frontend\app.js") }
    Invoke-QaStep "capabilities" {
        $capabilityJson = & python "tools\check_capabilities.py"
        if ($LASTEXITCODE -ne 0) {
            throw "Capability check failed."
        }
        $capabilityJson | Set-Content -LiteralPath (Join-Path $QaDir "capabilities.json")
        $summary.capabilities = $capabilityJson | ConvertFrom-Json
    }
    if (-not $SkipSampleExport) {
        $sampleOutput = Join-Path $QaDir "hdr_reference.avif"
        Invoke-QaStep "sample-export" { Invoke-LoggedCommand "sample-export" "python" @("tools\generate_hdr_reference.py", "--output", $sampleOutput) }
        Invoke-QaStep "sample-avif-info" {
            Invoke-LoggedCommand "sample-avif-info" "python" @(
                "tools\avif_info.py",
                $sampleOutput,
                "--json",
                (Join-Path $QaDir "hdr_reference_avif.json")
            )
        }
        if ($summary.capabilities.ultrahdr_encoder.status -eq "available") {
            $ultraHdrOutput = Join-Path $QaDir "hdr_reference_ultrahdr.jpg"
            $ultraHdrJson = Join-Path $QaDir "hdr_reference_ultrahdr.json"
            Invoke-QaStep "sample-ultrahdr-export-validate" {
                Invoke-LoggedCommand "sample-ultrahdr-export-validate" "python" @(
                    "tools\generate_ultrahdr_reference.py",
                    "--output", $ultraHdrOutput,
                    "--json", $ultraHdrJson
                )
            }
            $summary.ultrahdr = Get-Content -LiteralPath $ultraHdrJson -Raw | ConvertFrom-Json
        } else {
            $summary.ultrahdr = [ordered]@{
                status = "skipped"
                detail = $summary.capabilities.ultrahdr_encoder.detail
            }
        }
    }
    if (-not $SkipPlaywright) {
        Invoke-QaStep "playwright-preview" {
            Invoke-LoggedCommand "playwright-preview" "powershell" @(
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                ".\tools\playwright_preview.ps1",
                "-Url",
                "http://127.0.0.1:8012"
            )
        }
    }
    Invoke-QaStep "optional-export-capability-summary" {
        $toolState = [ordered]@{
            cjxl = if (Get-Command cjxl -ErrorAction SilentlyContinue) { "available" } else { "missing" }
            djxl = if (Get-Command djxl -ErrorAction SilentlyContinue) { "available" } else { "missing" }
            ultrahdr_app = $summary.capabilities.ultrahdr_encoder.status
            note = "JPEG XL remains deferred. JPEG Ultra HDR is validated when the pinned bundled encoder is available."
        }
        $summary.jxl_uhd = $toolState
        $toolState | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $QaDir "jxl_uhd_capability.json")
    }
} finally {
    Pop-Location
    $summaryPath = Join-Path $QaDir "summary.json"
    $summary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $summaryPath
    Write-Host "QA summary: $summaryPath"
}
