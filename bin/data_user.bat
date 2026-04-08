@echo off
call "%~dp0config.bat"

%MKLITTLEFS% -c ..\data\user -b 4096 -p 256 -s 0x120000 ..\build\user.bin
%ESPTOOL% --chip esp32s3 -p %PORT% --before usb_reset write_flash 0x5F0000 ..\build\user.bin
