#!/bin/bash
source "$(dirname "$0")/config.sh"

# Compile the application sketch
echo "========================================="
echo "   Compiling application firmware...     "
echo "        (This may take a minute)         "
echo "========================================="
arduino-cli compile --fqbn "$FQBN" --build-path ../build "$@" ../src

# Upload application firmware
echo "========================================="
echo "   Uploading application firmware...     "
echo "========================================="

$ESPTOOL --chip esp32s3 -p "$PORT" --before usb-reset write-flash 0x10000 ../build/src.ino.bin

if [ $? -ne 0 ]; then
    echo "========================================="
    echo "   ✖ Upload failed.                      "
    echo "   Try: different USB cable/port, or     "
    echo "   hold BOOT + press RST before running. "
    echo "========================================="
    exit 1
fi

echo "========================================="
echo "   ✔ Upload complete!                    "
echo "========================================="