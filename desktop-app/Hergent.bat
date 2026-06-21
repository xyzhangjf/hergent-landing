@echo off
:: Check if Edge WebView2 is installed
set WV2_KEY=HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}
reg query "%WV2_KEY%" /v pv >nul 2>&1
if %errorlevel% neq 0 (
    echo Installing WebView2 Runtime...
    :: Download the Evergreen bootstrapper
    bitsadmin /transfer WebView2Bootstrapper /download /priority FOREGROUND https://go.microsoft.com/fwlink/p/?LinkId=2124703 "%TEMP%\MicrosoftEdgeWebview2Setup.exe"
    if exist "%TEMP%\MicrosoftEdgeWebview2Setup.exe" (
        start /wait "" "%TEMP%\MicrosoftEdgeWebview2Setup.exe" /silent /install
        del "%TEMP%\MicrosoftEdgeWebview2Setup.exe"
    )
)

:: Start Hergent
start "" "%~dp0Hergent.exe"
