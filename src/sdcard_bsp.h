#ifndef SDCARD_BSP_H
#define SDCARD_BSP_H

#include <Arduino.h>
#include <esp_err.h> // Required for esp_err_t types
#include <SD_MMC.h>

// Initializes the SD Card using Arduino SD_MMC (1-bit mode)
void sdcard_init(void);

// Returns stats in bytes (Total, Used, Free)
void sdcard_get_stats(uint64_t* totalBytes, uint64_t* usedBytes, uint64_t* freeBytes);

// Legacy float getter: Returns Card Size in GB
float sdcard_GetValue(void);

// Write text data to a file (Overwrites existing)
esp_err_t s_example_write_file(const char *path, char *data);

// Read file content into a buffer
// WARNING: Ensure pxbuf is large enough to hold the file content!
esp_err_t s_example_read_file(const char *path, char *pxbuf, uint32_t *outLen);

#endif