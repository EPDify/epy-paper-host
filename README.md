# EPY Paper Host

A web-based file manager and single-page application (SPA) server packed in a tiny **Waveshare ESP32-S3 1.54-inch e-Paper AIoT development board**. It's a portable, ultra-low-power, E-Paper Pocket Computer.

![Waveshare ESP32-S3 1.54-inch e-Paper AIoT development board](https://github.com/zane-dev/epy-paper-host/blob/main/images/epy-paper-host.png) 

## 1. Prerequisites (Arduino CLI & esptool)

This project uses `arduino-cli` to handle dependencies, compiling, and flashing, and `esptool` v5.x for reliable firmware uploads.

### Arduino CLI

**On macOS (Using Homebrew)**
```bash
brew update
brew install arduino-cli
```

**On Windows (Manual Installation)**

1. **Download:** Get the latest release from the [Arduino CLI Releases page](https://github.com/arduino/arduino-cli/releases).
2. **Install/Extract:** 
   - If using the **MSI**, run it and follow the prompts.
   - If using the **Zip**, extract `arduino-cli.exe` to a permanent folder (e.g., `C:\Arduino-CLI`).
3. **Add to PATH:**
   - Search Windows for "Edit the system environment variables".
   - Click **Environment Variables** > Select **Path** in 'System variables' > **Edit**.
   - Click **New** and add the folder path where `arduino-cli.exe` is located.
4. **Verify:** Open a new PowerShell window and run `arduino-cli version`.
5. **Initialize:** Run `arduino-cli config init` to create the default configuration.

### esptool v5.x

The project requires `esptool` v5.x installed via pipx (see [Troubleshooting](#8-troubleshooting) for why the Arduino-bundled v4.6 was replaced).

**On macOS**
```bash
brew install pipx && pipx install esptool
```

**On Windows (Using PowerShell)**
1. **Install Python:** If you don't have Python, install it from the [Microsoft Store](https://apps.microsoft.com/store/detail/python-312/9NCVDN91XZV7) or [python.org](https://www.python.org/downloads/windows/).
2. **Bootstrap pipx:** Run the following to install `pipx` and add it to your PATH:
   ```powershell
   py -m pip install --user pipx
   py -m pipx ensurepath
   ```
   *(Note: You must **restart your terminal** or VS Code after running these commands for the changes to take effect.)*
3. **Install esptool:**
   ```powershell
   pipx install esptool
   ```

## 2. Library Dependencies

Before configuring your board details, you must install the global 3rd-party libraries required for the project (`ArduinoJson`, `ESPAsyncWebServer`, `Bounce2`, etc.).

Simply run the dependency script which handles the installation of the ESP32 core and all library dependencies:

**On macOS (Terminal)**
```bash
./bin/all_libs.sh
```

**On Windows (Command Prompt or PowerShell)**
```cmd
bin\all_libs.bat
```

> **Note:** The `ESPAsyncWebServer` library is installed from [mathieucarbou's fork](https://github.com/mathieucarbou/ESPAsyncWebServer) which natively supports ESP32 Core 3.x. The original `me-no-dev` version crashes on Core 3.x with a `tcp_alloc` TCPIP lock assertion error.

## 3. Configuration

Before you run any of the compiler and flasher scripts in the `bin/` directory, **you must configure the machine-specific properties**.

**On macOS:** Edit `bin/config.sh`

**On Windows:** Edit `bin/config.bat`

For each file:
1. Update the **`PORT`** variable to point to your connected ESP32-S3 (e.g. `/dev/cu.usbmodem1101` on macOS or `COM14` on Windows).
2. Ensure the **`MKLITTLEFS`** path correctly points to the `mklittlefs` binary downloaded by the ESP32 core.
   - **macOS:** Usually at `~/Library/Arduino15/packages/esp32/tools/mklittlefs/.../mklittlefs`
   - **Windows:** Usually at `%LOCALAPPDATA%\Arduino15\packages\esp32\tools\mklittlefs\...\mklittlefs.exe`


After updating the config, you can compile and flash the firmware:

**On macOS**
```bash
./bin/app.sh       # Uploads just the application firmware
./bin/all.sh       # Wipes and uploads the full firmware + sys & user data partitions
./bin/data_sys.sh  # Uploads only the system data partition (/sys)
./bin/data_user.sh # Uploads only the user data partition (/user) — overwrites existing user data!
```

**On Windows**
```cmd
bin\app.bat        
bin\all.bat        
bin\data_sys.bat   
bin\data_user.bat  
```

> **Note:** Both `all.sh` and `all.bat` contain a commented-out **"Erase flash memory"** step that performs a full chip erase (`erase_flash`). During the initial setup, you might want to wipe the entire flash memory for a fresh start — including the user data partition. You **must** also uncomment the `data_user.sh` / `data_user.bat` step in the same script to re-upload baseline user files, otherwise the device will boot with a missing user filesystem. Keep them commented-out after initial setup.

## 4. Build Scripts Reference

| Script           | macOS                  | Windows                 | Description                                                  |
|------------------|------------------------|-------------------------|--------------------------------------------------------------|
| **Config**       | `bin/config.sh`        | `bin\config.bat`        | Machine-specific settings (port, paths, baud rate)           |
| **Install Libs** | `bin/all_libs.sh`      | `bin\all_libs.bat`      | Install ESP32 core and all library dependencies              |
| **App Only**     | `bin/app.sh`           | `bin\app.bat`           | Compile & upload application firmware only                   |
| **Full Flash**   | `bin/all.sh`           | `bin\all.bat`           | Full compile + upload firmware, sys data, and user data      |
| **Sys Data**     | `bin/data_sys.sh`      | `bin\data_sys.bat`      | Build & upload the system LittleFS partition (`/sys`)        |
| **User Data**    | `bin/data_user.sh`     | `bin\data_user.bat`     | Build & upload the user LittleFS partition (`/user`)         |
> **Note:** data_user scripts will override the existing user data on the ESP32. Use with caution!

## 5. Flash Memory Layout

The ESP32 uses a custom partition scheme (defined in `src/partitions.csv`) to maximize space across standard code updates and LittleFS directories:

* **0x9000 (`nvs`, 16KB):** Non-Volatile Storage (Stores WiFi credentials and simple state logic).
* **0x10000 (`ota_0`, 2.18MB):** The primary executable factory firmware (`.bin`).
* **0x240000 (`ota_1`, 2.18MB):** The secondary executable firmware slot used for over-the-air (OTA) remote updates.
* **0x470000 (`app_fs`, 1.5MB):** Mounts as `/sys` using LittleFS to store read-only system UI assets.
* **0x5F0000 (`user_fs`, 1.12MB):** Mounts as `/user` using LittleFS for dynamic JSON settings, stats, and rotating log files.
* **0x710000 (`coredump`, 64KB):** Dedicated partition space to assist in caching crash logs if the ESP32 panics.

## 6. SD Card Formatting

The device requires an external microSD card for storage. The SD card MUST be formatted in **MS-DOS (FAT32)** to be readable by the ESP32.

**For macOS Users:**
1. Open **Disk Utility**.
2. Select your SD card from the sidebar.
3. Click **Erase**.
4. Set the Format to **MS-DOS (FAT)** and the Scheme to **Master Boot Record**.

**For Windows Users:**
1. Open **This PC**.
2. Right-click your SD card and select **Format...**.
3. Select **FAT32** under File System.

## 7. Hardware Button Interfaces

The physical buttons are wired to GPIO interrupts with internal debounce mapping. The interactions are defined as follows:

### **BOOT Button (GPIO 0)**
* **Single Click:** Navigate forward to the next UI screen view (e.g., Dashboard -> Connected).
* **Double Click:** Navigate backward to the previous UI screen view.
* **Long Press (Hold for 5 seconds):** Factory Reset Network. Clears all saved WiFi credentials from NVS space and triggers an immediate hard crash/reboot to return to Captive AP mode.

### **PWR Button (GPIO 18)**
* **Single Click:** Toggles the global power mode between "Eco Mode" (which enters deep sleep and utilizes RTC timeouts) and "Constant Mode" (continuous polling execution).
* **Double Click:** Synchronise RTC time with NTP server.
* **Long Press (Hold for 5 seconds):** Initiates a standard soft reboot (`ESP.restart()`).

## 8. Troubleshooting

### esptool v4.6 — "Device not configured" mid-upload (macOS)

The Arduino-bundled `esptool` v4.6 would frequently fail mid-upload with:
```
Writing at 0x0009c800... (46 %)
A serial exception error occurred: Could not configure port: (6, 'Device not configured')
```

**Root Cause:** The ESP32-S3 uses native USB CDC (not a dedicated USB-UART bridge chip). During flash writes, the chip can momentarily lose its USB device handle on macOS, causing pySerial to fail. This is a hardware-level timing issue — changing cables, ports, baud rates, or adding retry loops does not resolve it.

**Fix:** Upgrade to `esptool` v5.x, which has significantly improved USB CDC stability and flasher stub handling for the ESP32-S3:
```bash
brew install pipx && pipx install esptool
```
The `ESPTOOL` variable in `bin/config.sh` / `bin\config.bat` is already configured to use the pipx-installed binary on `PATH`.

**Additional notes:**
- The `--no-stub` flag (used with v4.6 as a workaround) is no longer needed — v5's flasher stub is stable over native USB.
- If uploads still fail, manually enter bootloader mode before flashing: hold **BOOT** → press & release **RST** → release **BOOT**.
