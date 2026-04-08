#ifndef EVENT_MANAGER_H
#define EVENT_MANAGER_H

#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>
#include "i2c_equipment.h"

// Define the maximum size for our string payloads
#define MAX_EVENT_STRINGS 5
#define MAX_STRING_LENGTH 32

// 1. The Event Types
enum EventType {
    EVENT_SETUP,
    EVENT_CONNECTED,
    EVENT_DASHBOARD,
    EVENT_ECO_MODE,
    EVENT_CONSTANT_MODE,
    EVENT_RTC_UPDATE,
    EVENT_LOG_ROTATION
};

// 2. The Event Object
// We use fixed char arrays to guarantee O(1) queue copying and zero heap fragmentation.
struct SystemEvent {
    EventType type;
    uint8_t payloadCount;                                // How many strings are actually attached
    char payloads[MAX_EVENT_STRINGS][MAX_STRING_LENGTH]; // Up to 5 strings, max 31 chars each + null terminator
};

// Expose the initialization and enqueue functions
void initEventManager(i2c_equipment *rtc_ptr);
bool enqueueEvent(EventType type, const char* strings[] = nullptr, uint8_t count = 0);
EventType getEventFromString(const char* eventName);

#endif