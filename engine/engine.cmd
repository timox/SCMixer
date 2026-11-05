@echo off
rem Lanceur du service moteur Mixette : engine.cmd start [--sc-dir <dossier>] ^| stop ^| status
node "%~dp0tools\engine-launcher.mjs" %*
exit /b %ERRORLEVEL%
