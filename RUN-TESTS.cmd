@echo off
rem Runs all of PressGO's local tests. Double-click this file. It never connects to Supabase or to any real database.
rem What it does, and how to read the result: see SETUP.md.
setlocal
cd /d "%~dp0"
title PressGO local tests

rem Only Git's own Bash is used. (The "bash.exe" in C:\Windows\System32 starts WSL, which this project does not need.)
set "GITBASH="
if exist "%ProgramFiles%\Git\bin\bash.exe" set "GITBASH=%ProgramFiles%\Git\bin\bash.exe"
if not defined GITBASH if exist "%ProgramFiles(x86)%\Git\bin\bash.exe" set "GITBASH=%ProgramFiles(x86)%\Git\bin\bash.exe"
if not defined GITBASH if exist "%LocalAppData%\Programs\Git\bin\bash.exe" set "GITBASH=%LocalAppData%\Programs\Git\bin\bash.exe"
if not defined GITBASH (
  echo Git for Windows was not found, and the database tests need its Bash. See "If something fails" in SETUP.md.
  pause
  exit /b 2
)

echo ============================================================
echo  1 of 3: database tests on a real, disposable PostgreSQL
echo ============================================================
"%GITBASH%" supabase/tests/run_local.sh
set "DBRC=%ERRORLEVEL%"
echo.

echo ============================================================
echo  2 of 3: the admin-users function, against a FAKE Supabase
echo ============================================================
node supabase\tests\functions\run_admin_users_test.mjs
set "FNRC=%ERRORLEVEL%"
echo.

echo ============================================================
echo  3 of 3: the web app's own logic tests (no database)
echo ============================================================
pushd desktop
call npm test
set "APPRC=%ERRORLEVEL%"
popd
echo.

echo ============================================================
echo  SUMMARY
echo ============================================================
if "%DBRC%"=="0" (echo   Database tests ........ PASSED ^(real PostgreSQL^)) else if "%DBRC%"=="2" (echo   Database tests ........ COULD NOT RUN ^(PostgreSQL not found or not starting: see SETUP.md^)) else (echo   Database tests ........ FAILED ^(see the FAIL lines above^))
if "%FNRC%"=="0" (echo   Admin-users function .. PASSED ^(fake Supabase, not the real one^)) else (echo   Admin-users function .. FAILED or could not run)
if "%APPRC%"=="0" (echo   Web app logic ......... PASSED) else (echo   Web app logic ......... FAILED or could not run)
echo.
echo   Nothing here connected to Supabase. Real Supabase sign-in and Storage are NOT covered.
echo.
pause
set /a TOTAL=%DBRC%+%FNRC%+%APPRC%
if not "%TOTAL%"=="0" exit /b 1
exit /b 0
