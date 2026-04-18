# Welcome to the EPY Paper Host Wiki!

Welcome to the official documentation and wiki for **EPY Paper Host**. 

## What is EPY Paper Host?

EPY Paper Host is a **web-based file manager and single-page application (SPA) server** packed into a tiny **Waveshare ESP32-S3 1.54-inch e-Paper AIoT development board**. It functions as a portable, ultra-low-power, E-Paper Pocket Computer.

Whether you're looking to manage your SD card storage anywhere within your local network, host your own single-page applications for easy access, or leverage a password-protected vault system for sensitive information and secure apps, EPY Paper Host has you covered.

---

## 📚 Wiki Contents

Navigate through the sections below to get started, configure the device, and learn how to use the built-in software features.

### 1. [Getting Started & Prerequisites](Getting-Started)
Everything you need to know before you start compiling.
* **Hardware Requirements:** The Waveshare ESP32-S3 e-Paper board and SD card formatting (FAT32).
* **Software Stack:** Installing Arduino CLI and `esptool` v5.x for robust flashing.
* **Library Dependencies:** Using the provided bash/batch scripts to fetch required global ESP32 libraries.

### 2. [Hardware Controls & Device Interface](Hardware-Controls)
Learn how to physically interact with the ESP32-S3 development board.
* **E-Paper Display:** Information about the device
* **Buttons:** How to interact with the device

### 3. [Using the Web Portal](Web-Portal)
A comprehensive guide to the Single-Page Application served straight from the ESP32.
* **Connectivity:** Catching the Captive Portal AP or joining your local Wi-Fi.
* **Dashboard and System settings:** Update system settings and reboot the device.
* **File Manager:** Create, delete, update, and download files stored on the SD card. Or open a file with your custom/personal editor (an SPA created by yourself and hosted on the SD card).
* **Apps and Routing:** Access the SPAs and links in standalone mode or add/edit/remove one or more SPAs to the web portal.
* **Vault System:** A password-protected vault system for sensitive information and secure apps.




## Get Involved

EPY Paper Host is fully open source! Whether you want to improve the web interface, optimise the e-Paper rendering logic, or contribute back to the core routing, pull requests are heavily encouraged. 

Be sure to check out visual guides and project updates on our **[EPDify YouTube Channel](https://www.youtube.com/@EPDify-n6p)**!
