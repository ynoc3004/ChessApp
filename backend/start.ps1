$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$envFile = Join-Path $PSScriptRoot ".env"
$python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"

if (-not (Test-Path $python)) {
    throw "Không tìm thấy môi trường ảo tại backend\.venv. Hãy tạo/cài backend trước."
}

if (-not (Test-Path $envFile)) {
    Write-Host "Lần đầu chạy Admin: hãy đặt mã quản trị. Mã sẽ chỉ lưu trên máy này." -ForegroundColor Yellow
    $token = (Read-Host "Mã quản trị").Trim()
    if ([string]::IsNullOrWhiteSpace($token)) {
        throw "Mã quản trị không được để trống."
    }
    Set-Content -Path $envFile -Value "CHESSAPP_ADMIN_TOKEN=$token" -Encoding UTF8
    Write-Host "Đã lưu mã vào backend\.env (file này đã được Git bỏ qua)." -ForegroundColor Green
}

& $python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
