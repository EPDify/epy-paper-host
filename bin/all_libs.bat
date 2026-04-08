@echo off

echo =========================================
echo  Installing ESP32 Core ^& Tools
echo =========================================

REM Install ESP32 core (this downloads the compiler and mklittlefs)
arduino-cli core update-index --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli core install esp32:esp32 --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json

echo =========================================
echo  Installing Arduino Library Dependencies
echo =========================================

REM Install all 3rd party libraries via arduino-cli
arduino-cli lib install "ArduinoJson" "Bounce2" "NTPClient" "SensorLib" "Adafruit GFX Library" "RTClib"

echo =========================================
echo  Installing ESPAsyncWebServer (Core 3.x)
echo =========================================

REM Remove any old/incompatible async library versions that conflict
set ARDUINO_LIBS=%USERPROFILE%\Documents\Arduino\libraries
if exist "%ARDUINO_LIBS%\ESPAsyncWebServer-master" rmdir /s /q "%ARDUINO_LIBS%\ESPAsyncWebServer-master"
if exist "%ARDUINO_LIBS%\ESPAsyncWebSrv" rmdir /s /q "%ARDUINO_LIBS%\ESPAsyncWebSrv"
if exist "%ARDUINO_LIBS%\ESPAsyncTCP" rmdir /s /q "%ARDUINO_LIBS%\ESPAsyncTCP"
if exist "%ARDUINO_LIBS%\AsyncTCP" rmdir /s /q "%ARDUINO_LIBS%\AsyncTCP"

REM Enable git-url installs (required for installing from GitHub)
arduino-cli config set library.enable_unsafe_install true

REM Use mathieucarbou's forks which natively support ESP32 Core 3.x / ESP-IDF 5.x
REM The original me-no-dev versions crash with: "assert failed: tcp_alloc ... Required to lock TCPIP core functionality!"
arduino-cli lib install --git-url https://github.com/mathieucarbou/AsyncTCP.git
arduino-cli lib install --git-url https://github.com/mathieucarbou/ESPAsyncWebServer.git

echo =========================================
echo  All dependencies installed!
echo =========================================
