param([int]$RootProcessId)
$ErrorActionPreference = 'Stop'
$ownedIds = [System.Collections.Generic.HashSet[int]]::new()
[void]$ownedIds.Add($RootProcessId)
while (Get-Process -Id $RootProcessId -ErrorAction SilentlyContinue) {
    # Refresh the tree so helpers started after the first sample are counted.
    $allProcesses = Get-CimInstance Win32_Process
    do {
        $added = $false
        foreach ($entry in $allProcesses) {
            if ($ownedIds.Contains([int]$entry.ParentProcessId) -and $ownedIds.Add([int]$entry.ProcessId)) { $added = $true }
        }
    } while ($added)
    $rows = @(Get-Process -Id @($ownedIds) -ErrorAction SilentlyContinue | ForEach-Object {
        @{ id = $_.Id; name = $_.ProcessName; workingSetBytes = $_.WorkingSet64; privateBytes = $_.PrivateMemorySize64 }
    })
    @{ at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); processes = $rows } | ConvertTo-Json -Depth 4 -Compress
    Start-Sleep -Milliseconds 500
}
