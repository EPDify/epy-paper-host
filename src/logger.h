// Logger.h
#ifndef LOGGER_H
#define LOGGER_H

#include <Arduino.h>
#include <LittleFS.h>
#include <vector>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include "i2c_equipment.h" // Required for RtcDateTime_t and i2c_equipment class

// Configuration Constants
#define LOG_DIR "/logs"
#define CURRENT_LOG_PATH "/logs/current.txt"
#define RETENTION_DAYS 7
#define MAX_LOG_LINES 200

class Logger {
public:
    Logger(); // Default constructor

    // Initialization method now accepts pointers to dependencies
    void begin(fs::LittleFSFS* fs, i2c_equipment* rtc);
    
    // Core logging methods
    void info(String message, bool consoleLog = true);
    void warn(String message, bool consoleLog = true);
    void error(String message, bool consoleLog = true);

    // File operations
    void save();      // Flushes buffer to disk
    void rotate();    // Rotates current log to archived date file
    void cleanup();   // Deletes old logs

private:
    SemaphoreHandle_t _mutex = NULL;
    // Pointers allow late initialization (references do not)
    fs::LittleFSFS* _fs = nullptr;
    i2c_equipment* _rtc = nullptr;

    String _logLines[MAX_LOG_LINES];
    int _logLineCount = 0;

    void addLogLine(String text);
    void clearBuffer();
    String getTimestamp();
    String normalizePath(String path);
    
    // Internal generic print helper
    void log(String level, String message, bool consoleLog);
};

#endif