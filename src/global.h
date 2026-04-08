#ifndef GLOBAL_H
#define GLOBAL_H

#include "Arduino.h"
#include "Preferences.h"
#include "device_config.h"
#include "epd_wrapper.h"
#include "logger.h"
#include <LittleFS.h>
#include <RTClib.h>
#include <Wire.h>

#define Audio_PWR_PIN GPIO_NUM_42
#define VBAT_PWR_PIN GPIO_NUM_17

/* bat management */
#define BAT_ADC_PIN 4
#define REF_VOLTAGE 3.3
#define DIVIDER_RATIO 2.0

#define BOOT_BUTTON_PIN GPIO_NUM_0
#define PWR_BUTTON_PIN GPIO_NUM_18

/* Low-power wake-up */
#define ext_wakeup_pin_1 GPIO_NUM_0

#define ETA6098_ADDR 0x55

/* i2c dev */
#define I2C_RTC_DEV_Address 0x51
#define I2C_SHTC3_DEV_Address 0x70

/* --- EPD PINS --- */
#define EPD_PWR_PIN 6
#define EPD_CS_PIN 11
#define EPD_DC_PIN 10
#define EPD_RST_PIN 9
#define EPD_BUSY_PIN 8
#define EPD_SCK_PIN 12
#define EPD_MOSI_PIN 13
#define EPD_SPI_HOST SPI2_HOST

#define EPD_WIDTH 200
#define EPD_HEIGHT 200

/** Preference non-volatile storage **/
extern const String appNamespace;
/** WiFi Manager **/
extern const String KEY_STATUS_SCREEN;

extern Preferences prefs;
extern fs::LittleFSFS SysFS;
extern fs::LittleFSFS UserFS;
extern DeviceConfig globalConfig;
extern EPD_Wrapper display;
extern Logger logger;

#endif