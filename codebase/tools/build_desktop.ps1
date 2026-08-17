$ErrorActionPreference = "Stop"

$codebase = Split-Path -Parent $PSScriptRoot
$venvPython = Join-Path $codebase ".venv\Scripts\python.exe"
$python = if ($env:HDR_FINISHER_PYTHON) {
    $env:HDR_FINISHER_PYTHON
} elseif (Test-Path -LiteralPath $venvPython) {
    $venvPython
} else {
    (Get-Command python -ErrorAction Stop).Source
}
$desktop = Join-Path $codebase "desktop"

Push-Location $codebase
try {
    & $python -m PyInstaller --noconfirm --clean .\HDRFinisherBackend.spec
    if ($LASTEXITCODE -ne 0) { throw "PyInstaller backend build failed." }
}
finally {
    Pop-Location
}

Push-Location $desktop
try {
    npm run dist:win
    if ($LASTEXITCODE -ne 0) { throw "Electron Windows package build failed." }
}
finally {
    Pop-Location
}
