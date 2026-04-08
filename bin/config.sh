#!/bin/bash

# ========================================================
# Machine-specific Configuration (macOS)
# Update these paths when moving to a different machine!
# ========================================================

# The serial port your ESP32 is connected to
export PORT="/dev/cu.usbmodem1101"

# The upload baud rate. Lower this (e.g. 115200 or 460800) if you get 'Device not configured' errors mid-upload!
export UPLOAD_SPEED="460800"

# The Fully Qualified Board Name for arduino-cli
export FQBN="esp32:esp32:esp32s3:PartitionScheme=custom,FlashSize=8M"

# Path to the Arduino bundled mklittlefs binary
export MKLITTLEFS="$HOME/Library/Arduino15/packages/esp32/tools/mklittlefs/3.0.0-gnu12-dc7f933/mklittlefs"

# Path to esptool (v5.x installed via pipx, on PATH)
export ESPTOOL="esptool"

# Forcefully patch the archaic ESP32 core definitions if UPLOAD_SPEED is modified
if [ -n "$UPLOAD_SPEED" ]; then
    for board_file in "$HOME/Library/Arduino15/packages/esp32/hardware/esp32/"*/boards.txt; do
        if [ -f "$board_file" ]; then
            sed -i.bak -E "s/esp32s3\.upload\.speed=[0-9]+/esp32s3.upload.speed=$UPLOAD_SPEED/g" "$board_file"
        fi
    done
fi
