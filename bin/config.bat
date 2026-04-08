@echo off
REM ========================================================
REM Machine-specific Configuration (Windows)
REM Update these paths when moving to a different machine!
REM ========================================================

REM The serial port your ESP32 is connected to
set PORT=COM14

REM The upload baud rate. Lower this (e.g. 115200 or 460800) if you get upload errors!
set UPLOAD_SPEED=460800

REM The Fully Qualified Board Name for arduino-cli
set FQBN=esp32:esp32:esp32s3:PartitionScheme=custom,FlashSize=8M

REM Path to the Arduino bundled mklittlefs binary
set MKLITTLEFS=%LOCALAPPDATA%\Arduino15\packages\esp32\tools\mklittlefs\4.0.2-db0513a\mklittlefs.exe

REM Path to esptool (v5.x installed via pipx, on PATH)
set ESPTOOL=esptool

REM Patch upload speed in boards.txt if UPLOAD_SPEED is set
if defined UPLOAD_SPEED (
    for /d %%d in ("%LOCALAPPDATA%\Arduino15\packages\esp32\hardware\esp32\*") do (
        if exist "%%d\boards.txt" (
            powershell -Command "(Get-Content '%%d\boards.txt') -replace 'esp32s3\.upload\.speed=\d+', 'esp32s3.upload.speed=%UPLOAD_SPEED%' | Set-Content '%%d\boards.txt'"
        )
    )
)
