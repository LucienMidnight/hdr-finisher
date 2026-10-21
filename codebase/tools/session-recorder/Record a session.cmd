@echo off
rem Starts HDR Finisher from source and records how it behaves while you use it.
rem Press F9 in the app whenever something feels slow. Close the app to finish;
rem the report is written to codebase\output\recorder\<date and time>\report.md.
cd /d "%~dp0..\.."
node tools\session-recorder\record.js
echo.
pause
