@echo off
REM Pushar commiten "Preload the watchlist at app start" till main.
REM Gar det inte direkt (ruleset) pushas den som branch i stallet.
cd /d "%~dp0"
echo.
echo === Pushar till main ===
git push origin main
if %ERRORLEVEL%==0 goto done
echo.
echo === Direktpush nekades, pushar branch i stallet ===
git push -u origin main:refs/heads/perf/watchlist-preload
:done
echo.
echo === Klart. Exit code: %ERRORLEVEL% ===
pause
