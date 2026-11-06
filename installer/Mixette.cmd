@echo off
rem Lanceur installe de Mixette SC : demarre le service moteur avec le SuperCollider embarque (son PID est
rem inscrit dans le registre des processus du moteur ; deja demarre, il est garde), puis l'interface.
rem Adresse de l'API : MIXETTE_ENGINE_PORT pour le service, MIXETTE_ENGINE_URL pour l'interface.
setlocal
set "ROOT=%~dp0"
call "%ROOT%engine\engine.cmd" start --sc-dir "%ROOT%supercollider"
if errorlevel 1 (
  echo.
  echo Le service moteur n'a pas demarre. Voir le journal indique ci-dessus.
  pause
  exit /b 1
)
start "" "%ROOT%desktop\mixette-desktop.exe"
