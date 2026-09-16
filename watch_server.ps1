$py = 'C:\Users\Admin\AppData\Local\Python\pythoncore-3.14-64\python.exe'
if (-not (Test-Path -LiteralPath $py)) { $py = (Get-Command python.exe -ErrorAction SilentlyContinue).Source }
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $scriptRoot) { $scriptRoot = 'C:\Users\Admin\Videos\project' }
$log = Join-Path $scriptRoot 'watchdog.log'
$proj = $scriptRoot

function Log($msg) {
  try { Add-Content -LiteralPath $log -Value ((Get-Date -Format 'HH:mm:ss') + '  ' + $msg) -Encoding UTF8 } catch { }
}

function Ensure-Server {
  $busy = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
  if ($busy) { return }
  Log "listener missing - starting python"
  try {
    $p = Start-Process -FilePath $py -ArgumentList 'server.py' -WorkingDirectory $proj -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput (Join-Path $proj 'python.out') -RedirectStandardError (Join-Path $proj 'python.err')
    Log "started PID $($p.Id)"
  } catch {
    Log "FAILED: $($_.Exception.Message)"
  }
}

Log 'watchdog started'
Ensure-Server
Start-Sleep -Seconds 3
try { [System.Diagnostics.Process]::Start('http://localhost:8000') } catch { }
while ($true) {
  Start-Sleep -Seconds 20
  Ensure-Server
  $pCount = @(Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue).Count
  Log ('check: python count=' + $pCount + ' listener=' + [bool](Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue))
}