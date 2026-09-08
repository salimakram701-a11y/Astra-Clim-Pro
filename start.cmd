@echo off
set "PORT=8787"
if "%ASTRA_TOKEN_SECRET%"=="" echo Attention: definissez ASTRA_TOKEN_SECRET avant une mise en production.
node server.mjs
pause
