// Flow contract: stop only listeners on the explicitly configured local API ports across supported hosts.
import { spawnSync } from 'node:child_process'

const ports = String(process.env.PORTS || '3000')
  .split(/[\s,]+/u)
  .filter(Boolean)

if (!ports.every((port) => /^\d{1,5}$/u.test(port) && Number(port) <= 65535)) {
  console.error(`ERROR: invalid local API port list: ${ports.join(',')}`)
  process.exit(1)
}

let result
if (process.platform === 'win32') {
  const powershell = [
    "$ports = $env:LOCAL_CLOSE_PORTS -split ','",
    'foreach ($port in $ports) {',
    '  $listeners = Get-NetTCPConnection -LocalPort ([int]$port) -State Listen -ErrorAction SilentlyContinue',
    '  $listenerPids = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)',
    '  if ($listenerPids.Count -eq 0) { Write-Output "[local:close] no process is listening on port $port"; continue }',
    '  Write-Output "[local:close] closing processes on port $port`: $($listenerPids -join \',\')"',
    '  foreach ($listenerPid in $listenerPids) { Stop-Process -Id $listenerPid -ErrorAction SilentlyContinue }',
    '  Start-Sleep -Milliseconds 500',
    '  $remaining = @(Get-NetTCPConnection -LocalPort ([int]$port) -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)',
    '  foreach ($listenerPid in $remaining) { Stop-Process -Id $listenerPid -Force -ErrorAction SilentlyContinue }',
    '}',
    'Write-Output "[local:close] done"',
  ].join('; ')
  result = spawnSync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', powershell],
    {
      stdio: 'inherit',
      env: { ...process.env, LOCAL_CLOSE_PORTS: ports.join(',') },
    },
  )
} else {
  result = spawnSync('bash', ['./scripts/local-close.sh'], {
    stdio: 'inherit',
    env: { ...process.env, PORTS: ports.join(' ') },
  })
}

if (result.error) {
  console.error(`ERROR: unable to close the local API: ${result.error.message}`)
  process.exit(1)
}
process.exit(result.status ?? 1)
