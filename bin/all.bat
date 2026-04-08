@echo off
call "%~dp0config.bat"

REM Compiling complete firmware image (application + partitions)
echo =========================================
echo    Compiling complete firmware image...
echo         (This may take a minute)
echo =========================================
arduino-cli compile --fqbn "%FQBN%" --build-path ..\build --clean ..\src

REM Find boot_app0.bin
set BOOT_APP=
for /d %%d in ("%LOCALAPPDATA%\Arduino15\packages\esp32\hardware\esp32\*") do (
    if exist "%%d\tools\partitions\boot_app0.bin" (
        set "BOOT_APP=%%d\tools\partitions\boot_app0.bin"
    )
)

if not defined BOOT_APP (
    echo =========================================
    echo    boot_app0.bin not found!
    echo    Ensure ESP32 core is installed.
    echo =========================================
    exit /b 1
)

REM Erase entire flash memory (Uncomment if you want to comopletely reset the device)
REM Make sure ./data_user.bat is also uncommented when running this. Otherwise, the device will miss baseline user files.
REM echo =========================================
REM echo    Erasing flash memory...
REM echo =========================================
REM %ESPTOOL% --chip esp32s3 -p %PORT% --before usb_reset erase_flash

REM Upload firmware
echo =========================================
echo    Uploading firmware...
echo =========================================

%ESPTOOL% --chip esp32s3 -p %PORT% --before usb_reset write_flash ^
  0x0000 ..\build\src.ino.bootloader.bin ^
  0x8000 ..\build\src.ino.partitions.bin ^
  0xe000 "%BOOT_APP%" ^
  0x10000 ..\build\src.ino.bin

if %ERRORLEVEL% neq 0 (
    echo =========================================
    echo    Upload failed.
    echo    Try: different USB cable/port, or
    echo    hold BOOT + press RST before running.
    echo =========================================
    exit /b 1
)

echo =========================================
echo    Firmware upload complete!
echo =========================================

REM Upload data partitions
REM data_user.bat is commented out because it will overwrite the user data partition. Use with caution.
REM call "%~dp0data_user.bat"
call "%~dp0data_sys.bat"
