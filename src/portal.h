#ifndef PORTAL_H
#define PORTAL_H

#include <Arduino.h>
#include <ESPAsyncWebServer.h>
#include <FS.h>
#include <vector>
#include "i2c_equipment.h"
#include "sdcard_bsp.h"
#include "utils.h"
#include "user_data.h"

class Portal {
public:
    // Constructor
    Portal();

    // Attach routes to the provided server
    void begin(AsyncWebServer *server, i2c_equipment_shtc3 *sensor_ptr, UserData *userdata_ptr);

    // Call this in the main loop() to handle reboots
    void loop();

    void persistStats();
    void initVaultSecurity();
    String getVaultSalt();

private:
    UserData *userdata = NULL;

    i2c_equipment_shtc3 *shtc3 = NULL;
    bool _shouldReboot;
    
    // Upload state tracking
    uint8_t *_uploadBuffer;
    size_t _bufferOffset;
    unsigned long _uploadStartTime;
    FILE* _uploadFile;

    // Internal helper methods
    String _humanReadableSize(const uint64_t bytes);
    void _deleteRecursive(String path);
    void _listDirRecursive(const char * dirname, String &json, bool &first);
    String _listFiles();
    String _processor(const String& var);

    // Request Handlers
    void _handleUpload(AsyncWebServerRequest *request, String filename, size_t index, uint8_t *data, size_t len, bool final);
    void _handleListFiles(AsyncWebServerRequest *request);
    void _handleFileGetAction(AsyncWebServerRequest *request);
    void _handleFileDeleteAction(AsyncWebServerRequest *request);
    void _handleMkdir(AsyncWebServerRequest *request);
    void _handleReboot(AsyncWebServerRequest *request);

    void updateVaultIndex(String newFilename, bool add);
    String generateSalt(int len);
    String encryptString(String input, String key);
    String decryptString(String hexInput, String key);
    void syncCredFile();
    bool isVaultAuthenticated(AsyncWebServerRequest *request);
};

#endif