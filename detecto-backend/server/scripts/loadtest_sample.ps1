param(
    [int]$DurationSeconds = 75,
    [int]$IntervalSeconds = 2,
    [string]$OutCsv = "sample.csv"
)

# Get-Process -Name python would also catch this session's own unrelated
# python.exe processes (this test harness's own capture client, VSCode/Cursor
# python extensions, etc.) -- CommandLine filtering via CIM is how we isolate
# just this test's uvicorn server (server\app.py) and its N live_infer.py
# inference children.
"timestamp,total_cpu_pct,free_mem_mb,server_cpu_s,server_mem_mb,infer_procs,infer_cpu_s,infer_mem_mb" | Out-File -FilePath $OutCsv -Encoding utf8

$deadline = (Get-Date).AddSeconds($DurationSeconds)

while ((Get-Date) -lt $deadline) {
    $ts = Get-Date -Format "o"

    $cpuPct = $null
    try {
        $cpuPct = (Get-Counter '\Processor(_Total)\% Processor Time').CounterSamples[0].CookedValue
    } catch {}

    $os = Get-CimInstance Win32_OperatingSystem
    $freeMemMb = [math]::Round($os.FreePhysicalMemory / 1024)

    $procs = Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
        Select-Object ProcessId, CommandLine

    $serverProc = $procs | Where-Object { $_.CommandLine -like '*server\app.py*' -or $_.CommandLine -like '*server/app.py*' }
    $inferProcs = $procs | Where-Object { $_.CommandLine -like '*live_infer.py*' }

    function Stats($procList) {
        $cpuSum = 0.0; $memSum = 0.0; $count = 0
        foreach ($p in $procList) {
            try {
                $real = Get-Process -Id $p.ProcessId -ErrorAction Stop
                $cpuSum += $real.CPU
                $memSum += $real.WorkingSet64
                $count += 1
            } catch {}
        }
        return @{ Cpu = $cpuSum; MemMb = [math]::Round($memSum / 1MB); Count = $count }
    }

    $s = Stats $serverProc
    $i = Stats $inferProcs

    "$ts,$([math]::Round($cpuPct,1)),$freeMemMb,$([math]::Round($s.Cpu,1)),$($s.MemMb),$($i.Count),$([math]::Round($i.Cpu,1)),$($i.MemMb)" | Out-File -FilePath $OutCsv -Append -Encoding utf8

    Start-Sleep -Seconds $IntervalSeconds
}
