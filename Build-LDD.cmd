@echo off
setlocal
cd /d "%~dp0"
title LDD 0.2.0 Windows Builder

echo ============================================================
echo   LDD 0.2.0 - Windows x64 one-click build
echo ============================================================
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Build-LDD.ps1"
set "LDD_BUILD_EXIT=%ERRORLEVEL%"

echo.
if "%LDD_BUILD_EXIT%"=="0" (
  echo Build completed successfully.
  echo Open the release folder to find LDD-Setup-0.2.0-x64.exe.
  start "" "%~dp0release"
) else (
  echo Build failed with exit code %LDD_BUILD_EXIT%.
  echo See .build-logs for the complete build transcript.
)
echo.
pause
exit /b %LDD_BUILD_EXIT%
