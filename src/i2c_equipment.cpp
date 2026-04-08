#include <Arduino.h>
#include <Wire.h>
#include "i2c_equipment.h"
#include <NTPClient.h>
#include <WiFiUdp.h>
#include <time.h>

/* --- SHTC3 CONSTANTS --- */
#define SHTC3_ADDRESS 0x70

WiFiUDP ntpUDP;
NTPClient timeClient(ntpUDP, "pool.ntp.org", 0);

/* --- RTC CLASS IMPLEMENTATION --- */

// The RTC library (SensorPCF85063) likely expects a specific callback signature.
// Since we are moving to standard Arduino, we can usually simplify this 
// if the library supports Wire, or we adapt the callback to use Wire.
// Assuming SensorPCF85063.hpp handles Wire internally or we just need to pass the interface.
// If the library is hardcoded to the old callback, we adapt it here:

static bool rtc_Callback(uint8_t addr, uint8_t reg, uint8_t *buf, size_t len, bool writeReg, bool isWrite)
{
    Wire.beginTransmission(addr);
    if (writeReg) {
        Wire.write(reg);
    }
    
    if (isWrite) {
        Wire.write(buf, len);
        return (Wire.endTransmission() == 0);
    } else {
        if (writeReg) {
            // If we wrote a register address, we need to restart or end/begin read
            if (Wire.endTransmission(false) != 0) return false; 
        }
        
        Wire.requestFrom((int)addr, (int)len);
        for (size_t i = 0; i < len; i++) {
            if (Wire.available()) {
                buf[i] = Wire.read();
            } else {
                return false;
            }
        }
        return true;
    }
}

i2c_equipment::i2c_equipment() {
    if(!rtc.begin(rtc_Callback)) {
        Serial.println("RTC Init Failed");
    }
}

i2c_equipment::~i2c_equipment() {}

void i2c_equipment::set_rtcTime(uint16_t year, uint8_t month, uint8_t day, uint8_t hour, uint8_t minute, uint8_t second) {
    rtc.setDateTime(year, month, day, hour, minute, second);
}

RtcDateTime_t i2c_equipment::get_rtcTime() {
    RTC_DateTime datetime = rtc.getDateTime();
    time.year = datetime.getYear();
    time.month = datetime.getMonth();
    time.day = datetime.getDay();
    time.hour = datetime.getHour();
    time.minute = datetime.getMinute();
    time.second = datetime.getSecond();
    time.week = datetime.getWeek();
    return time;
}

void i2c_equipment::syncRTCwithNTP(long timezoneOffsetSecs) {
    timeClient.begin();
    // Set offset here to ensure NTPClient gets correct local time epoch
    timeClient.setTimeOffset(timezoneOffsetSecs); 
    
    if (timeClient.update()) {
        unsigned long epochTime = timeClient.getEpochTime();
        
        // Use standard C library to convert Epoch to Calendar Date
        time_t rawTime = (time_t)epochTime;
        struct tm * t;
        t = localtime(&rawTime); 

        // Note: tm_year is years since 1900, tm_mon is 0-11
        uint16_t year = t->tm_year + 1900;
        uint8_t month = t->tm_mon + 1;
        uint8_t day   = t->tm_mday;
        uint8_t hour  = t->tm_hour;
        uint8_t min   = t->tm_min;
        uint8_t sec   = t->tm_sec;

        // Update your external RTC
        this->set_rtcTime(year, month, day, hour, min, sec);
        Serial.println("RTC Updated from NTP!");
    } else {
        Serial.println("NTP Update Failed");
    }
}

/* --- SHTC3 CLASS IMPLEMENTATION --- */

i2c_equipment_shtc3::i2c_equipment_shtc3() {
    shtc3_Wakeup();
    shtc3_SoftReset();
    delay(20);
    SHTC3_GetId();
    Serial.printf("SHTC3 ID: %04x\n", shtc3_id);
}

i2c_equipment_shtc3::~i2c_equipment_shtc3() {}

etError i2c_equipment_shtc3::SHTC3_GetId() {
    // Command: READ_ID (0xEFC8)
    uint8_t cmdMSB = (READ_ID >> 8) & 0xFF;
    uint8_t cmdLSB = READ_ID & 0xFF;

    Wire.beginTransmission(SHTC3_ADDRESS);
    Wire.write(cmdMSB);
    Wire.write(cmdLSB);
    if (Wire.endTransmission() != 0) return ACK_ERROR;

    // Read 3 bytes (Data MSB, Data LSB, CRC)
    Wire.requestFrom(SHTC3_ADDRESS, 3);
    if (Wire.available() < 3) return ACK_ERROR;

    uint8_t msb = Wire.read();
    uint8_t lsb = Wire.read();
    uint8_t crc = Wire.read();

    uint8_t data[2] = {msb, lsb};
    if (SHTC3_CheckCrc(data, 2, crc) != NO_ERROR) return CHECKSUM_ERROR;

    shtc3_id = (msb << 8) | lsb;
    return NO_ERROR;
}

etError i2c_equipment_shtc3::shtc3_Wakeup() {
    // Command: WAKEUP (0x3517)
    Wire.beginTransmission(SHTC3_ADDRESS);
    Wire.write((WAKEUP >> 8) & 0xFF);
    Wire.write(WAKEUP & 0xFF);
    
    int err = Wire.endTransmission();
    delay(1); // Small delay after wakeup
    return (err == 0) ? NO_ERROR : ACK_ERROR;
}

etError i2c_equipment_shtc3::shtc3_Sleep() {
    // Command: SLEEP (0xB098)
    Wire.beginTransmission(SHTC3_ADDRESS);
    Wire.write((SLEEP >> 8) & 0xFF);
    Wire.write(SLEEP & 0xFF);
    return (Wire.endTransmission() == 0) ? NO_ERROR : ACK_ERROR;
}

etError i2c_equipment_shtc3::shtc3_SoftReset() {
    Wire.beginTransmission(SHTC3_ADDRESS);
    Wire.write((SOFT_RESET >> 8) & 0xFF);
    Wire.write(SOFT_RESET & 0xFF);
    return (Wire.endTransmission() == 0) ? NO_ERROR : ACK_ERROR;
}

etError i2c_equipment_shtc3::SHTC3_GetTempAndHumiPolling(float *temp, float *humi) {
    // 1. Send Measurement Command (Polling Mode)
    Wire.beginTransmission(SHTC3_ADDRESS);
    Wire.write((MEAS_T_RH_POLLING >> 8) & 0xFF);
    Wire.write(MEAS_T_RH_POLLING & 0xFF);
    if (Wire.endTransmission() != 0) return ACK_ERROR;

    // 2. Wait for measurement
    delay(20);

    // 3. Read 6 Bytes (T_MSB, T_LSB, T_CRC, RH_MSB, RH_LSB, RH_CRC)
    Wire.requestFrom(SHTC3_ADDRESS, 6);
    if (Wire.available() < 6) return ACK_ERROR;

    uint8_t bytes[6];
    for(int i=0; i<6; i++) bytes[i] = Wire.read();

    // 4. Verify CRC
    if (SHTC3_CheckCrc(bytes, 2, bytes[2]) != NO_ERROR) return CHECKSUM_ERROR;
    if (SHTC3_CheckCrc(&bytes[3], 2, bytes[5]) != NO_ERROR) return CHECKSUM_ERROR;

    // 5. Calculate Values
    uint16_t rawTemp = (bytes[0] << 8) | bytes[1];
    uint16_t rawHumi = (bytes[3] << 8) | bytes[4];

    *temp = SHTC3_CalcTemperature(rawTemp);
    *humi = SHTC3_CalcHumidity(rawHumi);

    return NO_ERROR;
}

etError i2c_equipment_shtc3::SHTC3_CheckCrc(uint8_t data[], uint8_t nbrOfBytes, uint8_t checksum) {
    uint8_t crc = 0xFF;
    uint8_t poly = 0x31; // CRC-8 polynomial x^8 + x^5 + x^4 + 1 = 0x131 -> 0x31

    for (uint8_t byteCtr = 0; byteCtr < nbrOfBytes; ++byteCtr) {
        crc ^= (data[byteCtr]);
        for (uint8_t bit = 8; bit > 0; --bit) {
            if (crc & 0x80) {
                crc = (crc << 1) ^ poly;
            } else {
                crc = (crc << 1);
            }
        }
    }
    return (crc == checksum) ? NO_ERROR : CHECKSUM_ERROR;
}

float i2c_equipment_shtc3::SHTC3_CalcTemperature(uint16_t rawValue) {
    return 175.0f * (float)rawValue / 65536.0f - 45.0f;
}

float i2c_equipment_shtc3::SHTC3_CalcHumidity(uint16_t rawValue) {
    return 100.0f * (float)rawValue / 65536.0f;
}

shtc3_data_t i2c_equipment_shtc3::readTempHumi() {
    shtc3_data_t data = {0.0, 0.0};
    shtc3_Wakeup();
    
    float t, h;
    if (SHTC3_GetTempAndHumiPolling(&t, &h) == NO_ERROR) {
        data.Temp = t;
        data.RH = h;
    } else {
        Serial.println("SHTC3 Read Error");
    }
    
    shtc3_Sleep();
    return data;
}