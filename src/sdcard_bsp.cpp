#include "sdcard_bsp.h"
#include <FS.h>

// Pin Definitions (Matching your original BSP)
#define SDMMC_D0_PIN    40
#define SDMMC_CLK_PIN   39
#define SDMMC_CMD_PIN   41

#define SD_MOUNT_POINT "/sdcard"

// Internal flag to track if card is successfully mounted
static bool _card_mounted = false;

void sdcard_init(void)
{
    if (_card_mounted) {
        Serial.println("SD Card already initialized");
        return;
    }

    // Configure pins: CLK, CMD, D0
    SD_MMC.setPins(SDMMC_CLK_PIN, SDMMC_CMD_PIN, SDMMC_D0_PIN);

    // Mount the SD Card
    // First arg: Mount point "/sdcard"
    // Second arg: true = 1-bit mode (Required for your hardware)
    if (!SD_MMC.begin(SD_MOUNT_POINT, true)) {
        Serial.println("Card Mount Failed");
        _card_mounted = false;
        return;
    }

    _card_mounted = true;

    // Print Card Info to Serial (similar to original sdmmc_card_print_info)
    uint8_t cardType = SD_MMC.cardType();
    if(cardType == CARD_NONE){
        Serial.println("No SD Card attached");
        return;
    }

    Serial.print("SD Card Type: ");
    if(cardType == CARD_MMC) Serial.println("MMC");
    else if(cardType == CARD_SD) Serial.println("SDSC");
    else if(cardType == CARD_SDHC) Serial.println("SDHC");
    else Serial.println("UNKNOWN");

    uint64_t cardSize = SD_MMC.cardSize() / (1024 * 1024);
    Serial.printf("SD Card Size: %lluMB\n", cardSize);
}

void sdcard_get_stats(uint64_t* totalBytes, uint64_t* usedBytes, uint64_t* freeBytes) {
    if (!_card_mounted) {
        *totalBytes = 0; *usedBytes = 0; *freeBytes = 0;
        return;
    }

    *totalBytes = SD_MMC.totalBytes();
    *usedBytes = SD_MMC.usedBytes();
    *freeBytes = *totalBytes - *usedBytes;
}

float sdcard_GetValue(void) {
    if (!_card_mounted) return 0;
    // Returns size in GB to match roughly original logic
    return (float)SD_MMC.cardSize() / (1024.0 * 1024.0 * 1024.0);
}

esp_err_t s_example_write_file(const char *path, char *data) {
    if (!_card_mounted) return ESP_ERR_NOT_FOUND;

    // Open file for writing (replaces standard fopen)
    File file = SD_MMC.open(path, FILE_WRITE);
    if (!file) {
        Serial.println("Failed to open file for writing");
        return ESP_FAIL;
    }

    if (file.print(data)) {
        file.close();
        return ESP_OK;
    } else {
        file.close();
        return ESP_FAIL;
    }
}

esp_err_t s_example_read_file(const char *path, char *pxbuf, uint32_t *outLen) {
    if (!_card_mounted) return ESP_ERR_NOT_FOUND;

    File file = SD_MMC.open(path, FILE_READ);
    if (!file) {
        Serial.println("Failed to open file for reading");
        return ESP_ERR_NOT_FOUND;
    }

    // Get file size
    size_t size = file.size();
    if (outLen != NULL) {
        *outLen = size; // Pass size back to caller
    }

    // Read data into buffer
    // Note: Caller must ensure pxbuf is big enough!
    file.read((uint8_t *)pxbuf, size);
    
    // Null-terminate if treating as string (optional, but safer for text)
    // pxbuf[size] = '\0'; 

    file.close();
    return ESP_OK;
}