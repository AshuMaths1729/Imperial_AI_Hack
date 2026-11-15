# Starts the FastAPI backend (:8000) and the Next.js frontend (:3000) together.
# Ctrl+C stops both. Requires uv and Node on PATH.
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"

Write-Host "Starting FastAPI backend on http://127.0.0.1:8000 ..."
$backendProc = Start-Process -FilePath "uv" `
    -ArgumentList @("run", "uvicorn", "app.main:app", "--reload", "--port", "8000") `
    -WorkingDirectory $Backend -NoNewWindow -PassThru

Write-Host "Starting Next.js frontend on http://localhost:3000 ..."
$frontendProc = Start-Process -FilePath "npm.cmd" `
    -ArgumentList @("run", "dev") `
    -WorkingDirectory $Frontend -NoNewWindow -PassThru

try {
    Wait-Process -Id $backendProc.Id, $frontendProc.Id
}
finally {
    Write-Host "Stopping Athena..."
    foreach ($p in @($backendProc, $frontendProc)) {
        if ($p -and -not $p.HasExited) {
            # /T also stops child processes (uvicorn reloader, next dev workers)
            & taskkill /PID $p.Id /T /F | Out-Null
        }
    }
}
