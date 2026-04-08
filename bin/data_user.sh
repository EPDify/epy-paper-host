#!/bin/bash
source "$(dirname "$0")/config.sh"

$MKLITTLEFS -c ../data/user -b 4096 -p 256 -s 0x120000 ../build/user.bin
$ESPTOOL --chip esp32s3 -p "$PORT" --before usb-reset write-flash 0x5F0000 ../build/user.bin