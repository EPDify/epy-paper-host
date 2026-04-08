#ifndef UTILS_H
#define UTILS_H

#include <Arduino.h>

class Utils {
public:
    // Static method: Can be called without creating an instance of Utils
    static void formatStorage(uint64_t bytes, float &outValue, char* outUnit);
};

#endif