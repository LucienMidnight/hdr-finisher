param([int]$RootProcessId)
$ErrorActionPreference = 'Stop'
$allProcesses = Get-CimInstance Win32_Process
$ownedIds = [System.Collections.Generic.HashSet[int]]::new()
[void]$ownedIds.Add($RootProcessId)
do {
    $added = $false
    foreach ($entry in $allProcesses) {
        if ($ownedIds.Contains([int]$entry.ParentProcessId) -and $ownedIds.Add([int]$entry.ProcessId)) { $added = $true }
    }
} while ($added)
while (Get-Process -Id $RootProcessId -ErrorAction SilentlyContinue) {
    $processRows = @(Get-Process -Id @($ownedIds) -ErrorAction SilentlyContinue | ForEach-Object {
        @{ id = $_.Id; name = $_.ProcessName; workingSetBytes = $_.WorkingSet64; privateBytes = $_.PrivateMemorySize64; cpuSeconds = $_.CPU }
    })
    $board = & nvidia-smi --query-gpu=memory.used,utilization.gpu --format=csv,noheader,nounits 2>$null
    @{ capturedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); processes = $processRows; boardSample = "$board" } | ConvertTo-Json -Depth 4 -Compress
    Start-Sleep -Milliseconds 1000
}
