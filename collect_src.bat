@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
set "OUT=src_all.txt"
if exist "%OUT%" del "%OUT%"

rem ---- root files ----
for %%F in (vite.config.ts index.html package.json tsconfig.json tsconfig.app.json tsconfig.node.json) do (
  if exist "%%F" call :add "%%F"
)

rem ---- src and supabase\functions (only .ts .tsx .css, so .env is never included) ----
for %%D in (src supabase\functions) do (
  if exist "%%D" (
    for /f "delims=" %%F in ('dir /s /b /a-d "%%D\*.ts" "%%D\*.tsx" "%%D\*.css"') do (
      set "P=%%F"
      set "P=!P:%CD%\=!"
      call :add "!P!"
    )
  )
)

echo Done: %OUT%
endlocal
exit /b

:add
echo ===== %~1 =====>> "%OUT%"
type "%~1">> "%OUT%"
echo.>> "%OUT%"
exit /b
