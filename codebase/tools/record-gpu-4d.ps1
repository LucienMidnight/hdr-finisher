param([int]$RootPid,[string]$Output)
$ErrorActionPreference='Stop'
[IO.File]::WriteAllText($Output,'')
while(Get-Process -Id $RootPid -ErrorAction SilentlyContinue){
  $start=Get-Date
  $all=Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name
  $ids=New-Object 'System.Collections.Generic.HashSet[int]'
  [void]$ids.Add($RootPid)
  do{$grew=$false;foreach($p in $all){if($ids.Contains([int]$p.ParentProcessId)-and $ids.Add([int]$p.ProcessId)){$grew=$true}}}while($grew)
  $rows=@{}
  $sets=Get-Counter '\GPU Process Memory(*)\Dedicated Usage','\GPU Process Memory(*)\Shared Usage'
  foreach($s in $sets.CounterSamples){if($s.InstanceName -match '^pid_(\d+)_' -and $ids.Contains([int]$Matches[1])){
    $key=$Matches[1];if(!$rows.ContainsKey($key)){$rows[$key]=@{pid=[int]$key;dedicatedBytes=0;sharedBytes=0}}
    if($s.Path -match 'dedicated usage'){$rows[$key].dedicatedBytes+=$s.CookedValue}else{$rows[$key].sharedBytes+=$s.CookedValue}
  }}
  $record=@{at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();durationMs=((Get-Date)-$start).TotalMilliseconds;processes=@($rows.Values)}|ConvertTo-Json -Compress -Depth 5
  [IO.File]::AppendAllText($Output,$record+"`n")
  Start-Sleep -Milliseconds 1000
}
