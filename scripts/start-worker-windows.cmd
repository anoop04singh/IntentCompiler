@echo off
setlocal
for /f "usebackq tokens=*" %%i in (`"%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "GRAPHRAIL_VS=%%i"
if not defined GRAPHRAIL_VS (
  echo Install Visual Studio Build Tools with Desktop development with C++.
  exit /b 1
)
call "%GRAPHRAIL_VS%\VC\Auxiliary\Build\vcvars64.bat"
if errorlevel 1 exit /b 1
cd /d "%~dp0.."
node dist/src/worker-main.js
