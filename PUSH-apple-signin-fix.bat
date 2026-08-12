@echo off
REM Pushar commiten "Fix Sign in with Apple onboarding for App Store guideline 4" till main.
REM Gar det inte direkt (ruleset) pushas den som branch i stallet.
cd /d "%~dp0"
echo.
echo === Pushar till main ===
git push origin main
if %ERRORLEVEL%==0 goto done
echo.
echo === Direktpush nekades, pushar branch i stallet ===
git push -u origin main:refs/heads/fix/apple-signin-guideline-4
:done
echo.
echo === Klart. Exit code: %ERRORLEVEL% ===
pause
