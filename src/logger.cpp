// Logger.cpp
#include "Logger.h"

Logger::Logger() {
    // Constructor is now empty
}

void Logger::begin(fs::LittleFSFS* fs, i2c_equipment* rtc) {
    _fs = fs;
    _rtc = rtc;

    if (_mutex == NULL) {
        _mutex = xSemaphoreCreateMutex();
    }

    // Safety check: only create directory if FS pointer is valid
    if (_fs) {
        if (!_fs->exists(LOG_DIR)) {
            _fs->mkdir(LOG_DIR);
        }
    }
}

String Logger::getTimestamp() {
    // Safety check: if RTC pointer is null, return error string
    if (!_rtc) return "[No RTC]";

    // 1. Try RTC via your custom wrapper
    // We check if the year is valid (e.g. > 2020) to determine if RTC is set
    RtcDateTime_t dt = _rtc->get_rtcTime();
    
    if (dt.year > 2020) {
       char buf[32];
       snprintf(buf, sizeof(buf), "[%04d-%02d-%02d %02d:%02d:%02d]", 
                dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second);
       return String(buf);
    }

    // 2. Fallback to System Time (ESP32 internal time)
    time_t now;
    struct tm timeinfo;
    time(&now);
    localtime_r(&now, &timeinfo);
    
    if (timeinfo.tm_year + 1900 > 2020) {
        char buf[32];
        strftime(buf, sizeof(buf), "[%Y-%m-%d %H:%M:%S]", &timeinfo);
        return String(buf);
    }

    // 3. Fallback to millis if no valid time source found
    return "[Up:" + String(millis() / 1000) + "s]";
}

void Logger::addLogLine(String text) {
    if (_mutex) xSemaphoreTake(_mutex, portMAX_DELAY);
    if (_logLineCount < MAX_LOG_LINES) {
        _logLines[_logLineCount++] = text;
    } else {
        Serial.println("ERR: Log buffer full");
    }
    if (_mutex) xSemaphoreGive(_mutex);
}

void Logger::clearBuffer() {
    for (int i = 0; i < _logLineCount; i++) {
        _logLines[i] = "";
    }
    _logLineCount = 0;
}

void Logger::log(String level, String message, bool consoleLog) {
    String timestamp = getTimestamp();
    String entry = level + message + (timestamp.length() > 0 ? " " + timestamp : "");

    if (consoleLog) {
        Serial.println(entry);
    }
    addLogLine(entry);
}

void Logger::info(String message, bool consoleLog) {
    log("INFO: ", message, consoleLog);
}

void Logger::warn(String message, bool consoleLog) {
    log("WARN: ", message, consoleLog);
}

void Logger::error(String message, bool consoleLog) {
    log("ERROR: ", message, consoleLog);
}

void Logger::save() {
    // Safety checks
    if (!_fs) return;

    if (_mutex) xSemaphoreTake(_mutex, portMAX_DELAY);

    if (_logLineCount == 0) {
        if (_mutex) xSemaphoreGive(_mutex);
        return;
    }

    File file;
    // Open in Append mode via pointer
    file = _fs->open(CURRENT_LOG_PATH, FILE_APPEND);
    
    if (!file) {
        // Try creating if append failed (sometimes needed on fresh FS)
        file = _fs->open(CURRENT_LOG_PATH, FILE_WRITE);
        if (!file) {
            clearBuffer();
            if (_mutex) xSemaphoreGive(_mutex);
            this->error("FS: Failed to open log file");
            return;
        }
    }

    for (int i = 0; i < _logLineCount; i++) {
        file.println(_logLines[i]);
    }

    file.close();
    clearBuffer();
    if (_mutex) xSemaphoreGive(_mutex);

    this->info("Logs saved to disk.");
}

String Logger::normalizePath(String path) {
    // Fixes ESP32 LittleFS behavior where file.name() might return full path
    if (path.startsWith("/")) return path;
    return String(LOG_DIR) + "/" + path;
}

void Logger::cleanup() {
    if (!_fs || !_rtc) return;
    
    Serial.println("FS: Cleanup started...");
    
    File root = _fs->open(LOG_DIR);
    if (!root || !root.isDirectory()) {
        Serial.println("FS: Log dir invalid");
        return;
    }

    // Get current date for age comparison
    RtcDateTime_t nowDt = _rtc->get_rtcTime();
    
    // Fallback: If RTC is invalid (year < 2020), do not delete logs to prevent accidental data loss
    if (nowDt.year < 2020) {
        Serial.println("FS: RTC invalid, skipping cleanup safety check.");
        root.close();
        return;
    }

    long currentDays = nowDt.year * 365 + nowDt.month * 30 + nowDt.day;
    std::vector<String> filesToDelete;

    File file = root.openNextFile();
    while (file) {
        String fName = String(file.name());
        String fullPath = normalizePath(fName);

        // Skip current.txt
        if (fName.indexOf("current.txt") >= 0) {
            file = root.openNextFile();
            continue;
        }

        // Extract filename from path for parsing
        int lastSlash = fullPath.lastIndexOf('/');
        String nameOnly = fullPath.substring(lastSlash + 1);

        int y, m, d;
        // Parse format: YYYY-MM-DD.txt
        if (sscanf(nameOnly.c_str(), "%d-%d-%d.txt", &y, &m, &d) == 3) {
            long fileDays = y * 365 + m * 30 + d;
            
            // Delete if older than RETENTION_DAYS
            if ((currentDays - fileDays) > RETENTION_DAYS) {
                filesToDelete.push_back(fullPath);
            }
        }
        file = root.openNextFile();
    }
    root.close();

    for (const auto& path : filesToDelete) {
        if (_fs->remove(path)) {
            Serial.print("Deleted: "); Serial.println(path);
        } else {
            Serial.print("Fail Del: "); Serial.println(path);
        }
    }
}

void Logger::rotate() {
    if (!_fs || !_rtc) return;
    if (!_fs->exists(CURRENT_LOG_PATH)) return;

    // Flush current buffer first
    save();

    RtcDateTime_t now = _rtc->get_rtcTime();
    
    // If RTC is invalid, we cannot rotate safely with a date name
    if (now.year < 2020) {
         this->error("FS: RTC invalid, skipping rotation.");
         return;
    }

    char fileName[64];
    // Rotate to today's date
    snprintf(fileName, sizeof(fileName), "%s/%04d-%02d-%02d.txt", 
             LOG_DIR, now.year, now.month, now.day);

    String targetPath = String(fileName);

    this->info("Rotating logs to: " + targetPath);

    // If target exists, append content
    if (_fs->exists(targetPath)) {
        File source = _fs->open(CURRENT_LOG_PATH, FILE_READ);
        File dest = _fs->open(targetPath, FILE_APPEND);
        
        if (source && dest) {
            uint8_t buf[128];
            while (source.available()) {
                int n = source.read(buf, sizeof(buf));
                dest.write(buf, n);
            }
            dest.close();
            source.close();
            _fs->remove(CURRENT_LOG_PATH);
        }
    } else {
        // Simple rename
        _fs->rename(CURRENT_LOG_PATH, targetPath);
    }
    
    // Clean up old files after rotation
    cleanup();
}