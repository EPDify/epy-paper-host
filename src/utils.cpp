#include "Utils.h"

void Utils::formatStorage(uint64_t bytes, float &outValue, char* outUnit) {
    if (bytes >= 1073741824ULL) { // 1 GB
        outValue = (float)bytes / 1073741824.0f;
        strcpy(outUnit, "GB");
    } else if (bytes >= 1048576ULL) { // 1 MB
        outValue = (float)bytes / 1048576.0f;
        strcpy(outUnit, "MB");
    } else if (bytes >= 1024ULL) { // 1 KB
        outValue = (float)bytes / 1024.0f;
        strcpy(outUnit, "KB");
    } else {
        outValue = (float)bytes;
        strcpy(outUnit, "B");
    }
}