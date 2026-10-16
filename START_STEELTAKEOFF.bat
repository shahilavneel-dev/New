@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>&1
if %ERRORLEVEL% EQU 0 (
  set "PY=py -3"
) else (
  set "PY=python"
)
%PY% -c "import sys;sys.exit(0 if sys.version_info >= (3,11) else 1)"
if errorlevel 1 (
  echo Python 3.11 or newer is required. Install from https://www.python.org/downloads/
  echo Select Add Python to PATH during installation.
  pause
  exit /b 1
)
if not exist ".venv\Scripts\python.exe" (
  echo Preparing your local Python environment...
  %PY% -m venv .venv
  if errorlevel 1 goto error
)
echo Checking application packages. Internet is needed on first launch.
".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r requirements-lock.txt
if errorlevel 1 goto error
echo Starting SteelTakeoff AI. Keep this window open while estimating.
".venv\Scripts\python.exe" server.py
if errorlevel 1 goto error
exit /b 0
:error
echo SteelTakeoff AI could not start. Read the error above.
echo If port 8765 is already in use, close the earlier SteelTakeoff window.
pause
exit /b 1
