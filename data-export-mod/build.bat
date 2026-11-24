@echo off
rem Starforge Data Export: builds jars\forge_data_export.jar. Needs a JDK (javac, jar) on PATH.
rem Usage: build.bat "E:\Games\Starsector"     (the folder containing starsector-core)
rem Copyright (C) 2026 Claude. SPDX-License-Identifier: GPL-3.0-or-later
cd /d "%~dp0"
if "%~1"=="" (echo Usage: build.bat "path\to\Starsector" ^& exit /b 1)
set "CORE=%~1\starsector-core"
if not exist "%CORE%" set "CORE=%~1"
if exist build rmdir /s /q build
mkdir build
if not exist jars mkdir jars
javac --release 8 -nowarn -cp "%CORE%\starfarer.api.jar;%CORE%\log4j-1.2.9.jar;%CORE%\json.jar" -d build src\forgeexport\*.java || exit /b 1
pushd build
jar cf ..\jars\forge_data_export.jar . || (popd ^& exit /b 1)
popd
echo Built jars\forge_data_export.jar. Copy mod_info.json and jars\ into mods\Starforge Data Export\.
