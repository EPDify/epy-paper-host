#include "user_data.h"
#include "global.h"
#include <LittleFS.h> // Ensure this matches your global UserFS definition

UserData::UserData() {
    // Constructor
}

std::vector<EpyTool> UserData::getEpyTools() {
    std::vector<EpyTool> epyToolsList;

    // 1. Check if file exists
    if (!UserFS.exists(_toolsFilePath)) {
        Serial.printf("[UserData] Error: %s not found\n", _toolsFilePath);
        return epyToolsList; // Return empty vector
    }

    // 2. Open file
    File file = UserFS.open(_toolsFilePath, "r");
    if (!file) {
        Serial.println("[UserData] Error: Failed to open tools.json");
        return epyToolsList;
    }

    // 3. Parse JSON
    // Estimate size: tools.json with ~10 tools is < 2KB. 
    // Allocating 4KB to be safe. ArduinoJson v7 automatically manages memory if using JsonDocument, 
    // but for v6 (common in ESP32) we use DynamicJsonDocument.
    // Adjust size based on your max expected file size.
    DynamicJsonDocument doc(4096); 

    DeserializationError error = deserializeJson(doc, file);
    
    // Close file immediately after parsing to free resources
    file.close();

    if (error) {
        Serial.print(F("[UserData] deserializeJson() failed: "));
        Serial.println(error.f_str());
        return epyToolsList;
    }

    // 4. Extract Data
    JsonArray tools = doc["tools"];
    if (tools.isNull()) {
        Serial.println("[UserData] Error: 'tools' array not found in JSON");
        return epyToolsList;
    }

    for (JsonObject tool : tools) {
        // Check if epyTool flag is true
        bool isEpyTool = tool["epyTool"] | false; 

        if (isEpyTool) {
            const char* endpoint = tool["endpoint"];
            const char* sdPath = tool["sdPath"];

            // Validation: Ignore entries with missing values
            if (endpoint && sdPath && strlen(endpoint) > 0 && strlen(sdPath) > 0) {
                EpyTool newTool;
                newTool.endpoint = String(endpoint);
                newTool.sdPath = String(sdPath);
                
                epyToolsList.push_back(newTool);
                
                Serial.printf("[UserData] Found EPY Tool: %s -> %s\n", newTool.endpoint.c_str(), newTool.sdPath.c_str());
            } else {
                Serial.println("[UserData] Warning: Skipped invalid EPY tool (missing endpoint or sdPath)");
            }
        }
    }

    return epyToolsList;
}

int UserData::getBatteryPercentage() {
  // 1. Take Multiple Samples (Smoothing)
  // ADC readings can be noisy. We take 20 readings and average them.
  long sum = 0;
  for (int i = 0; i < 20; i++) {
    sum += analogRead(BAT_ADC_PIN);
    delay(5); // Small delay between reads
  }
  float rawAverage = sum / 20.0;

  // 2. Calculate Voltage
  // Formula: (ADC_Value / Max_ADC_Value) * Reference_Voltage * Divider_Factor
  float voltage = (rawAverage / 4095.0) * REF_VOLTAGE * DIVIDER_RATIO;

  // Optional: Debug print to calibrate
  // Serial.print("Debug Voltage: "); Serial.println(voltage);

  // 3. Convert Voltage to Percentage (Linear Approximation for LiPo)
  // We use a "ladder" logic to map voltage to percentage
  if (voltage >= 4.20) return 100;
  if (voltage >= 4.15) return 95;
  if (voltage >= 4.10) return 90;
  if (voltage >= 4.00) return 80;
  if (voltage >= 3.90) return 70;
  if (voltage >= 3.80) return 60;
  if (voltage >= 3.70) return 50;
  if (voltage >= 3.60) return 30;
  if (voltage >= 3.50) return 20;
  if (voltage >= 3.40) return 10;
  if (voltage <= 3.30) return 0; // Battery is essentially dead

  return 5; // Catch-all for that last bit of power
}

int UserData::getChargingStatus() {
  if (Serial && Serial.availableForWrite()) {
    return 1;
  } else {
    return 0;
  }
}