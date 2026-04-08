@echo off
call "%~dp0config.bat"

%MKLITTLEFS% -c ..\data\sys -b 4096 -p 256 -s 0x180000 ..\build\sys.bin
%ESPTOOL% --chip esp32s3 -p %PORT% --before usb_reset write_flash 0x470000 ..\build\sys.bin
