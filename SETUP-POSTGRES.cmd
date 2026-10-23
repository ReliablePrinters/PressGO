@echo off
rem One-time setup of the test database program (PostgreSQL). Already done on this computer; needed again only on a new computer.
rem It downloads about 364 MB from EDB (the company that builds PostgreSQL for Windows). No administrator rights are needed.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "supabase\tools\get-postgres.ps1" %*
pause
