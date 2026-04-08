#ifndef EPD_WRAPPER_H
#define EPD_WRAPPER_H


#include <Adafruit_GFX.h>
#include "i2c_equipment.h"
#include "user_data.h"
#include "epaper_driver_bsp.h"

class EPD_Wrapper : public Adafruit_GFX {
private:
    // --- FIX: Declare the sensor object pointer here ---
    i2c_equipment_shtc3 *shtc3 = NULL; 

    i2c_equipment *rtc = NULL;

    UserData *userdata = NULL;

    // Internal Helper Functions
    void fetchSDData(uint64_t &freeBytes, uint64_t &usedBytes, uint64_t &totalBytes);
    void fetchSensorData(float &temp, float &humidity);
    
    // Helper to convert bytes to GB/MB strings
    void formatStorage(uint64_t bytes, float &outValue, char* outUnit);

    void displayHeader();

public:
    epaper_driver_display driver;

    EPD_Wrapper();
    void begin(i2c_equipment_shtc3 *sensor_ptr, i2c_equipment *rtc_ptr, UserData *userdata_ptr);
    
    // Main command: Fetches data AND draws it
    void updateDashboard(); 

    void startSetup(); 

    void completeSetup();

    void constantMode();

    void ecoMode();

    // GFX Implementation
    void drawPixel(int16_t x, int16_t y, uint16_t color) override;
};

#endif