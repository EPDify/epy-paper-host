#!/bin/bash
source "$(dirname "$0")/config.sh"

# Compiling complete firmware image (application + partitions)
echo "========================================="
echo "   Compiling complete firmware image...  "
echo "        (This may take a minute)         "
echo "========================================="
arduino-cli compile --fqbn "$FQBN" --build-path ../build --clean ../src

# Erase entire flash memory (Uncomment if you want to comopletely reset the device)
# Make sure ./data_user.sh is also uncommented when running this. Otherwise, the device will miss baseline user files.
# echo "========================================="
# echo "   Erasing flash memory...               "
# echo "========================================="
# $ESPTOOL --chip esp32s3 -p "$PORT" --before usb-reset erase-flash

# Upload firmware
BOOT_APP=$(ls $HOME/Library/Arduino15/packages/esp32/hardware/esp32/*/tools/partitions/boot_app0.bin | head -n 1)

echo "========================================="
echo "   Uploading firmware...                 "
echo "========================================="

$ESPTOOL --chip esp32s3 -p "$PORT" --before usb-reset write-flash \
  0x0000 ../build/src.ino.bootloader.bin \
  0x8000 ../build/src.ino.partitions.bin \
  0xe000 "$BOOT_APP" \
  0x10000 ../build/src.ino.bin

if [ $? -ne 0 ]; then
    echo "========================================="
    echo "   ✖ Upload failed.                      "
    echo "   Try: different USB cable/port, or     "
    echo "   hold BOOT + press RST before running. "
    echo "========================================="
    exit 1
fi

echo "========================================="
echo "   ✔ Firmware upload complete!           "
echo "========================================="

# Upload data partitions
# ./data_user.sh is commented out because it will overwrite the user data partition. Use with caution.
# ./data_user.sh
./data_sys.sh