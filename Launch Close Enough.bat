@echo off
setlocal
title Close Enough

REM One-click launcher. Double-click this file to play.
REM Everything is resolved relative to this file, so the project folder can be
REM moved or renamed without breaking anything.

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed, or is not on your PATH.
  echo.
  echo   Install the LTS version from https://nodejs.org
  echo   then double-click this file again.
  echo.
  pause
  exit /b 1
)

node "scripts\launch.mjs"
set EXITCODE=%ERRORLEVEL%

if not "%EXITCODE%"=="0" (
  echo.
  echo   Close Enough stopped with an error. The message above explains why.
  echo.
  pause
)

endlocal
exit /b %EXITCODE%
