@echo off
rem Interface Qt du moteur SCMixer. Le service moteur doit etre demarre (engine\engine.cmd start) ;
rem l'interface ne le lance pas. Adresse de l'API : SCMIXER_ENGINE_URL (defaut http://127.0.0.1:3100).
setlocal
set "PATH=C:\Qt\6.12.0\mingw_64\bin;C:\Qt\Tools\mingw1310_64\bin;%PATH%"
set "APP=%~dp0build\mingw\scmixer.exe"
if not exist "%APP%" (
  echo Executable introuvable : %APP%
  echo Construire d'abord : cmake --preset mingw ^&^& cmake --build build\mingw
  exit /b 1
)
start "" "%APP%" %*
