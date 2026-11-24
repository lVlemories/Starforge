@echo off
rem Starts Starforge using the Java that ships with Starsector.
rem The editor finds your Starsector folder by itself (or asks you once in the browser and remembers it
rem in starsector-path.txt). You can keep this "Starforge" folder anywhere.
cd /d "%~dp0"
set "GAME=.."
if exist "starsector-path.txt" set /p GAME=<"starsector-path.txt"
set "JAVA="
for %%G in ("%GAME%" "%ProgramFiles(x86)%\Fractal Softworks\Starsector" "%ProgramFiles%\Fractal Softworks\Starsector" "C:\Starsector" "C:\Games\Starsector" "D:\Starsector" "D:\Games\Starsector" "E:\Starsector" "E:\Games\Starsector" "F:\Games\Starsector") do call :findjava "%%~G"
if not defined JAVA set "JAVA=java"
echo Using %JAVA%
"%JAVA%" -jar starforge.jar "%GAME%" 8765
if errorlevel 1 echo The editor stopped with an error - see above. It needs Java 11 or newer: Starsector's own jre folder works.
pause
goto :eof

:findjava
if defined JAVA goto :eof
for /d %%D in ("%~1\jdk-*") do if exist "%%D\bin\java.exe" set "JAVA=%%D\bin\java.exe"
if not defined JAVA if exist "%~1\jre\bin\java.exe" set "JAVA=%~1\jre\bin\java.exe"
goto :eof
