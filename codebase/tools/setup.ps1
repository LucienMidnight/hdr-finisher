$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'setup-machine.py'
if ($env:HDR_FINISHER_SETUP_PYTHON) {
    & $env:HDR_FINISHER_SETUP_PYTHON $script @args
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
    & py -3.12 $script @args
} else {
    & python $script @args
}
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
