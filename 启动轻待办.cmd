@echo off
chcp 65001 >nul
title Light Todo - Local Server
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher.ps1"
if errorlevel 1 pause
pause
