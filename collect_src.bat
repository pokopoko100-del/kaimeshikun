@echo off
rem ============================================================
rem  Collect src files + key root config files into one text file
rem  How to use:
rem   1) Put this file in the kaimeshikun folder (project root)
rem   2) Double-click to run
rem   3) "src_all.txt" will be created in the same folder
rem      -> Attach that file to Copilot
rem ============================================================

setlocal enabledelayedexpansion

set "ROOT=%~dp0src"
set "BASE=%~dp0"
set "OUT=%~dp0src_all.txt"

if exist "%OUT%" del "%OUT%"

echo Collecting root config files ...
for %%G in (vite.config.ts index.html package.json tsconfig.json tsconfig.app.json) do (
    if exist "%BASE%%%G" (
        echo   - %%G
        >>"%OUT%" echo ===== %%G =====
        >>"%OUT%" echo.
        type "%BASE%%%G" >> "%OUT%"
        >>"%OUT%" echo.
        >>"%OUT%" echo.
    )
)

if not exist "%ROOT%" (
    echo [ERROR] "src" folder was not found.
    echo Please put this bat file in the kaimeshikun folder, same level as "src".
    echo.
    pause
    exit /b 1
)

echo Collecting files under src ...
echo.

for /r "%ROOT%" %%F in (*.ts *.tsx *.js *.jsx *.css *.json) do (
    set "FULL=%%F"
    set "REL=!FULL:%ROOT%=!"
    echo   - !REL!
    >>"%OUT%" echo ===== src!REL! =====
    >>"%OUT%" echo.
    type "%%F" >> "%OUT%"
    >>"%OUT%" echo.
    >>"%OUT%" echo.
)

echo.
if exist "%OUT%" (
    echo Done! "%OUT%" has been created.
    echo Please attach this file to Copilot.
) else (
    echo [ERROR] Failed to create the output file.
)

echo.
echo Press any key to close this window.
pause >nul
