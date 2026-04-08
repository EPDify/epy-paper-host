#ifndef DEVICE_CONFIG_H
#define DEVICE_CONFIG_H

#include <Arduino.h>
#include "portal.h"
#include "i2c_equipment.h"

// Tightly packed struct for O(1) access and zero heap fragmentation
struct DeviceConfig {
    bool isEcoMode;
    bool isBatteryAttached;
    uint16_t interval;
    char screen[32]; // Fixed character array to prevent String heap fragmentation
    char ipAddress[16]; // IPv4 address (max 15 chars + null terminator)
    uint8_t lastSyncDay;
};

// Function declarations
void loadConfig();
void saveConfig();
void loopConfig(Portal *portal, i2c_equipment *rtc);
void resetSleepTimer();  // helper to reset the 30s countdown

#endif