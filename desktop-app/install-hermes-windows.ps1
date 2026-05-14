# Hergent - Hermes CLI Windows 安装脚本
# 以管理员身份运行 PowerShell，执行: .\install-hermes-windows.ps1

Write-Host "Hergent - Hermes AI 引擎安装" -ForegroundColor Cyan
Write-Host "================================`n"

# 检查 Python
Write-Host "[1/4] 检查 Python..." -ForegroundColor Yellow
$pythonCmd = $null
try {
    python --version 2>&1 | Out-Null
    $pythonCmd = "python"
    Write-Host "  Python 已就绪" -ForegroundColor Green
} catch {
    try {
        python3 --version 2>&1 | Out-Null
        $pythonCmd = "python3"
        Write-Host "  Python 已就绪" -ForegroundColor Green
    } catch {
        Write-Host "  错误: 需要安装 Python 3.11+ " -ForegroundColor Red
        Write-Host "  下载: https://www.python.org/downloads/" -ForegroundColor Yellow
        Write-Host "  安装时请勾选 'Add Python to PATH'" -ForegroundColor Yellow
        exit 1
    }
}

# 创建安装目录
Write-Host "`n[2/4] 创建安装目录..." -ForegroundColor Yellow
$hermesDir = "$env:USERPROFILE\.hermes\hermes-agent"
New-Item -ItemType Directory -Force -Path $hermesDir | Out-Null
Write-Host "  目录: $hermesDir" -ForegroundColor Green

# 创建虚拟环境
Write-Host "`n[3/4] 创建虚拟环境..." -ForegroundColor Yellow
& $pythonCmd -m venv "$hermesDir\venv"
Write-Host "  虚拟环境已创建" -ForegroundColor Green

# 安装 Hermes Agent
Write-Host "`n[4/4] 安装 Hermes Agent（需要网络）..." -ForegroundColor Yellow
$pipPath = "$hermesDir\venv\Scripts\pip.exe"
& $pipPath install --quiet hermes-agent
if ($LASTEXITCODE -eq 0) {
    Write-Host "  安装完成!" -ForegroundColor Green
} else {
    Write-Host "  安装失败，请检查网络连接后重试" -ForegroundColor Red
    exit 1
}

Write-Host "`n================================`n"
Write-Host "Hermes AI 引擎安装成功!" -ForegroundColor Cyan
Write-Host "启动 Hergent 后会自动检测引擎状态" -ForegroundColor White
