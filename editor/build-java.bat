@echo off
rem Starforge: builds starforge.jar (Java version) from src\ and web\. Needs a JDK 11+ (javac, jar) on PATH.
rem Copyright (C) 2026 Claude. SPDX-License-Identifier: GPL-3.0-or-later
cd /d "%~dp0"
if exist build rmdir /s /q build
mkdir build\web
javac --release 11 -nowarn -d build src\forge\*.java || goto :fail
copy /y web\* build\web\ >nul
if exist LICENSE (copy /y LICENSE build\LICENSE >nul) else (copy /y ..\LICENSE build\LICENSE >nul)
pushd build
jar cfm ..\starforge.jar ..\manifest.txt . || (popd ^& goto :fail)
popd
echo Built starforge.jar
exit /b 0
:fail
echo Build failed.
exit /b 1
