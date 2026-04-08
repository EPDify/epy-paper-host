#ifndef USER_DATA_H
#define USER_DATA_H

#include <Arduino.h>
#include <vector>
#include <ArduinoJson.h>

// Struct to hold the extracted tool information
typedef struct {
    String endpoint;
    String sdPath;
} EpyTool;

class UserData {
public:
    UserData();
    
    // Public function to get the list of EPY tools
    std::vector<EpyTool> getEpyTools();

    int getBatteryPercentage();
    int getChargingStatus();

private:
    const char* _toolsFilePath = "/dynamic/tools.json";
};

#endif