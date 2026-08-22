@echo off
setlocal
title LDD GitHub Windows Builder
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Push-to-GitHub.ps1"
set "code=%errorlevel%"
echo.
if "%code%"=="0" (
  echo Upload completed. GitHub Actions is building the EXE.
) else (
  echo Upload failed with exit code %code%.
)
pause
exit /b %code%
