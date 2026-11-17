@echo off
rem Starts the PressGO Test app (the isolated test build, NOT the real PressGO) so the startup animation can be hand-tested in each situation.
rem   TEST-STARTUP-SCENARIOS.cmd                 a normal start
rem   TEST-STARTUP-SCENARIOS.cmd slow:3000       the app starts loading after 3 s (full intro, calm state, hand-over). Try slow:15000 for "taking longer than usual"
rem   TEST-STARTUP-SCENARIOS.cmd offline:2       the first two attempts fail as if offline (countdown, "Try now"), the third succeeds
rem   TEST-STARTUP-SCENARIOS.cmd fail            "PressGO could not start" (Try again / Quit)
rem   TEST-STARTUP-SCENARIOS.cmd crash           the app process crashes while starting
rem The scenarios only work in the local PressGO Test build; the real app ignores them. Start the test site first:  cd C:\PressGO-TestEnv  then  node server.mjs
setlocal
set "SIM=%~1"
tasklist /FI "IMAGENAME eq PressGO Test.exe" 2>nul | find /I "PressGO Test.exe" >nul
if not errorlevel 1 (
  echo PressGO Test is already running. Close it first ^(it only starts one copy, so the scenario would be ignored^).
  exit /b 1
)
set "EXE="
for /f "delims=" %%i in ('powershell -NoProfile -Command "Get-ChildItem -Path '%~dp0dist-test\*\win-unpacked\PressGO Test.exe' -ErrorAction SilentlyContinue | Sort-Object { [version]$_.Directory.Parent.Name } -Descending | Select-Object -First 1 -ExpandProperty FullName"') do set "EXE=%%i"
if not defined EXE if exist "%LOCALAPPDATA%\Programs\PressGO Test\PressGO Test.exe" set "EXE=%LOCALAPPDATA%\Programs\PressGO Test\PressGO Test.exe"
if not defined EXE (
  echo Could not find the PressGO Test app. Build it first:  node try-build.js 1.2.1 --url=http://127.0.0.1:8082/
  exit /b 2
)
echo Starting: %EXE%
if defined SIM echo Scenario: %SIM%
set "PRESSGO_TEST_STARTUP=%SIM%"
start "" "%EXE%"
echo Timings of each start are written to %TEMP%\pressgo-startup-test.log
endlocal
