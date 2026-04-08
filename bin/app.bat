@echo off
call "%~dp0config.bat"

REM Compile the application sketch
echo =========================================
echo    Compiling application firmware...
echo         (This may take a minute)
echo =========================================
arduino-cli compile --fqbn "%FQBN%" --build-path ..\build %* ..\src

REM Upload application firmware
echo =========================================
echo    Uploading application firmware...
echo =========================================

%ESPTOOL% --chip esp32s3 -p %PORT% --before usb_reset write_flash 0x10000 ..\build\src.ino.bin

if %ERRORLEVEL% neq 0 (
    echo =========================================
    echo    Upload failed.
    echo    Try: different USB cable/port, or
    echo    hold BOOT + press RST before running.
    echo =========================================
    exit /b 1
)

echo =========================================
echo    Upload complete!
echo =========================================
