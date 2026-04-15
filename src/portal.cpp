#include "portal.h"
#include "global.h"
#include "sdcard_bsp.h"
#include <dirent.h>
#include <sys/stat.h>

#define FIRMWARE_VERSION "1.0.0"
#define SD_MOUNT_POINT "/sdcard"
#define UPLOAD_BUFFER_SIZE 8192
#define VAULT_SESSION_DURATION_MS 1800000 // 30 minutes
String vaultSalt = "";

struct VaultUploadState {
  bool isAuthenticated;
  String buffer;
};

// --- Custom Response Class (Internal Helper) ---
class AsyncVFSResponse : public AsyncAbstractResponse {
  FILE *_file;
  String _filename;

public:
  AsyncVFSResponse(const String &path, const String &contentType, bool download,
                   const String &filename) {
    _code = 200;
    _contentType = contentType;
    _filename = filename;
    _file = fopen(path.c_str(), "rb");

    if (_file) {
      fseek(_file, 0, SEEK_END);
      _contentLength = ftell(_file);
      fseek(_file, 0, SEEK_SET);

      if (download) {
        String headerValue = "attachment; filename=\"";
        headerValue += _filename;
        headerValue += "\"";
        addHeader("Content-Disposition", headerValue);
      }
    } else {
      _code = 404;
    }
  }
  ~AsyncVFSResponse() {
    if (_file)
      fclose(_file);
  }
  bool _sourceValid() const { return _file != NULL; }
  virtual size_t _fillBuffer(uint8_t *data, size_t len) override {
    if (!_file)
      return 0;
    return fread(data, 1, len, _file);
  }
};

// --- Portal Implementation ---

Portal::Portal() {
  _shouldReboot = false;
  _uploadBuffer = NULL;
  _bufferOffset = 0;
  _uploadStartTime = 0;
  _uploadFile = NULL;
}

void Portal::begin(AsyncWebServer *server, i2c_equipment_shtc3 *sensor_ptr,
                   UserData *userdata_ptr) {
  this->shtc3 = sensor_ptr;
  this->userdata = userdata_ptr;
  this->persistStats();
  this->initVaultSecurity();

  server->serveStatic("/css", SysFS, "/css/");
  server->serveStatic("/js", SysFS, "/js/");
  server->serveStatic("/data", SysFS, "/data/");
  server->serveStatic("/favicon.ico", SysFS, "/favicon.ico");
  server->serveStatic("/dynamic", UserFS, "/dynamic/");

  server->on("/logs/list.json", HTTP_GET, [](AsyncWebServerRequest *request) {
    DynamicJsonDocument doc(2048);
    JsonArray logsArray = doc.createNestedArray("logs");

    File logsDir = UserFS.open("/logs");
    if (logsDir && logsDir.isDirectory()) {
      File file = logsDir.openNextFile();
      while (file) {
        String fileName = file.name();
        if (fileName.endsWith(".txt")) {
          logsArray.add(fileName);
        }
        file = logsDir.openNextFile();
      }
      logsDir.close();
    }

    String jsonResponse;
    serializeJson(doc, jsonResponse);
    request->send(200, "application/json", jsonResponse);
  });
  server->serveStatic("/logs", UserFS, "/logs/");

  server->on("/api/vault/status", HTTP_GET, [](AsyncWebServerRequest *request) {
    AsyncWebServerResponse *response = request->beginResponse(204);
    response->addHeader("X-Vault-Salt", vaultSalt);
    response->addHeader("X-Vault-Duration", String(VAULT_SESSION_DURATION_MS));
    request->send(response);
  });

  server->on("/api/vault-auth", HTTP_POST, [this](AsyncWebServerRequest *request) {
    if (request->hasParam("encryptedPass", true)) {
      String encryptedPass = request->getParam("encryptedPass", true)->value();
      String decryptedPass = this->decryptString(encryptedPass, vaultSalt);

      prefs.begin("vault", true);
      String pass = prefs.getString("pass", "");
      String hint = prefs.getString("hint", "");
      prefs.end();

      if (pass.length() == 0) {
        request->send(404, "application/json", "{\"status\":\"error\", \"message\":\"Not setup\"}");
      } else if (pass == decryptedPass) {
        request->send(200, "application/json", "{\"status\":\"ok\"}");
      } else {
        String safeHint = hint;
        safeHint.replace("\\", "\\\\");
        safeHint.replace("\"", "\\\"");
        safeHint.replace("\n", "\\n");
        safeHint.replace("\r", "\\r");
        request->send(401, "application/json", "{\"status\":\"error\", \"message\":\"Unauthorized\", \"hint\":\"" + safeHint + "\"}");
      }
    } else {
      request->send(400, "application/json", "{\"status\":\"error\", \"message\":\"Missing parameters\"}");
    }
  });

  server->on("/api/secret", HTTP_GET, [this](AsyncWebServerRequest *request) {
    if (!this->isVaultAuthenticated(request)) {
      request->send(401, "application/json", "{\"error\":\"Unauthorized\"}");
      return;
    }
    if (request->hasParam("filename")) {
      String filename = request->getParam("filename")->value();
      if (filename.indexOf('/') != -1 || filename.indexOf("..") != -1) {
        request->send(400, "application/json", "{\"error\":\"Invalid filename\"}");
        return;
      }
      if (filename == "cred.json") {
        request->send(403, "application/json", "{\"error\":\"Access denied\"}");
        return;
      }
      String filePath = "/secret/" + filename;
      if (UserFS.exists(filePath)) {
        request->send(UserFS, filePath, "application/json");
      } else {
        request->send(404, "application/json", "{\"error\":\"Not found\"}");
      }
    } else {
      request->send(400, "application/json", "{\"error\":\"Missing filename\"}");
    }
  });

  server->on(
      "/dynamic/tools.json", HTTP_POST,
      [](AsyncWebServerRequest *request) {
        request->send(200, "application/json", "{\"status\":\"ok\"}");
      },
      NULL,
      [](AsyncWebServerRequest *request, uint8_t *data, size_t len,
         size_t index, size_t total) {
        static File jsonFile;
        if (index == 0) {
          if (!UserFS.exists("/dynamic"))
            UserFS.mkdir("/dynamic");
          jsonFile = UserFS.open("/dynamic/tools.json", FILE_WRITE);
        }
        if (jsonFile) {
          jsonFile.write(data, len);
          if (index + len == total)
            jsonFile.close();
        }
      });

  server->on(
      "/dynamic/setting.json", HTTP_POST,
      [](AsyncWebServerRequest *request) {
        request->send(200, "application/json", "{\"status\":\"ok\"}");
      },
      NULL,
      [](AsyncWebServerRequest *request, uint8_t *data, size_t len,
         size_t index, size_t total) {
        static File jsonFile;
        if (index == 0) {
          if (!UserFS.exists("/dynamic"))
            UserFS.mkdir("/dynamic");
          jsonFile = UserFS.open("/dynamic/setting.json", FILE_WRITE);
        }
        if (jsonFile) {
          jsonFile.write(data, len);
          if (index + len == total) {
            jsonFile.close();
            loadConfig(); // Reload config to global variables after saving new
                          // settings
          }
        }
      });

  // SD card user application routings
  std::vector<EpyTool> routings = this->userdata->getEpyTools();
  for (EpyTool tool : routings) {
    server->serveStatic(tool.endpoint.c_str(), SD_MMC, tool.sdPath.c_str())
        .setDefaultFile("index.html");
  }

  // Index Handler
  server->on("/", HTTP_GET, [this](AsyncWebServerRequest *request) {
    request->send(SysFS, "/index.html", String(), false,
                  std::bind(&Portal::_processor, this, std::placeholders::_1));
  });

  // API Handlers
  server->on("/system/listfiles", HTTP_GET,
             std::bind(&Portal::_handleListFiles, this, std::placeholders::_1));
  server->on(
      "/system/file", HTTP_GET,
      std::bind(&Portal::_handleFileGetAction, this, std::placeholders::_1));
  server->on(
      "/system/file", HTTP_DELETE,
      std::bind(&Portal::_handleFileDeleteAction, this, std::placeholders::_1));
  server->on("/system/mkdir", HTTP_GET,
             std::bind(&Portal::_handleMkdir, this, std::placeholders::_1));
  server->on("/system/reboot", HTTP_GET,
             std::bind(&Portal::_handleReboot, this, std::placeholders::_1));

  // Upload Handler (Requires specific lambda signature for the upload callback)
  server->on(
      "/system/upload", HTTP_POST,
      [](AsyncWebServerRequest *request) {
        // Post-upload response is handled inside _handleUpload's 'final' check,
        // but we can send a default if needed here only if not already sent.
      },
      [this](AsyncWebServerRequest *request, String filename, size_t index,
             uint8_t *data, size_t len, bool final) {
        // Strip SD_MOUNT_POINT from filename if present
        String processedFilename = filename;
        if (processedFilename.startsWith(SD_MOUNT_POINT)) {
          processedFilename =
              processedFilename.substring(strlen(SD_MOUNT_POINT));
        }
        this->_handleUpload(request, processedFilename, index, data, len,
                            final);
      });

  server->on(
      "/api/setup-vault", HTTP_POST, [this](AsyncWebServerRequest *request) {
        if (request->hasParam("encryptedPass", true) &&
            request->hasParam("hint", true)) {
          String encryptedPass =
              request->getParam("encryptedPass", true)->value();
          String hint = request->getParam("hint", true)->value();

          // Decrypt to plaintext
          String pass = decryptString(encryptedPass, vaultSalt);

          // 1. Store Plaintext in NVS
          prefs.begin("vault", false); // Read-write
          prefs.putString("pass", pass);
          prefs.putString("hint", hint);
          prefs.end();

          // 2. Sync to file (Encrypts it)
          this->syncCredFile();

          request->send(200, "application/json", "{\"status\":\"ok\"}");
        } else {
          request->send(
              400, "application/json",
              "{\"status\":\"error\", \"message\":\"Missing parameters\"}");
        }
      });

  server->on(
      "/api/secret", HTTP_POST,
      [this](AsyncWebServerRequest *request) {
        if (!this->isVaultAuthenticated(request)) {
          request->send(401, "application/json", "{\"status\":\"error\", \"message\":\"Unauthorized\"}");
        } else {
          request->send(200, "application/json", "{\"status\":\"ok\"}");
        }
      },
      NULL,
      [this](AsyncWebServerRequest *request, uint8_t *data, size_t len,
             size_t index, size_t total) {
        VaultUploadState *state = (VaultUploadState*)request->_tempObject;
        if (index == 0) {
          state = new VaultUploadState();
          state->isAuthenticated = this->isVaultAuthenticated(request);
          state->buffer = "";
          request->_tempObject = state;
        }

        if (!state || !state->isAuthenticated) {
          if (index + len == total && state) {
            delete state;
            request->_tempObject = NULL;
          }
          return;
        }
        
        for (size_t i = 0; i < len; i++)
          state->buffer += (char)data[i];

        if (index + len == total) {
          DynamicJsonDocument doc(4096);
          DeserializationError error = deserializeJson(doc, state->buffer);

          if (!error && doc.containsKey("filename") &&
              doc.containsKey("content")) {
            String filename = doc["filename"].as<String>();

            // Validate filename
            if (filename.indexOf('/') != -1 || filename.indexOf("..") != -1) {
              // skip path traversal silently
            } else if (filename == "cred.json" || filename == "vaults.json") {
              // skip protected files silently
            } else {

            // Normal Vault Handling
            String filePath = "/secret/" + filename;
            if (!UserFS.exists("/secret"))
              UserFS.mkdir("/secret");

              File file = UserFS.open(filePath, FILE_WRITE);
              if (file) {
                serializeJson(doc["content"], file);
                file.close();
                this->updateVaultIndex(filename, true);
              }
            }
          }
          delete state;
          request->_tempObject = NULL;
        }
      });

  // 4. DELETE /api/secret
  server->on("/api/secret", HTTP_DELETE,
             [this](AsyncWebServerRequest *request) {
               if (!this->isVaultAuthenticated(request)) {
                 request->send(401, "application/json", "{\"error\":\"Unauthorized\"}");
                 return;
               }
               if (request->hasParam("filename")) {
                 String filename = request->getParam("filename")->value();
                 if (filename.indexOf('/') != -1 || filename.indexOf("..") != -1) {
                   request->send(400, "application/json", "{\"error\":\"Invalid filename\"}");
                   return;
                 }
                 if (filename == "cred.json" || filename == "vaults.json") {
                   request->send(403, "application/json", "{\"error\":\"Access denied\"}");
                   return;
                 }

                 String filePath = "/secret/" + filename;
                 if (UserFS.exists(filePath)) {
                   UserFS.remove(filePath);
                   this->updateVaultIndex(filename, false);
                   request->send(200, "text/plain", "Deleted");
                 } else {
                   request->send(404, "text/plain", "File not found");
                 }
               } else {
                 request->send(400, "text/plain", "Missing filename");
               }
             });

  server->begin();
}

void Portal::loop() {
  if (_shouldReboot) {
    Serial.println("Portal: Rebooting...");
    delay(1000);
    ESP.restart();
  }
}

String Portal::_humanReadableSize(const uint64_t bytes) {
  if (bytes < 1024)
    return String((unsigned long)bytes) + " B";
  else if (bytes < (1024 * 1024))
    return String(bytes / 1024.0) + " KB";
  else if (bytes < (1024 * 1024 * 1024))
    return String(bytes / 1024.0 / 1024.0) + " MB";
  else
    return String(bytes / 1024.0 / 1024.0 / 1024.0) + " GB";
}

String Portal::_processor(const String &var) { return String(); }

void Portal::_listDirRecursive(const char *dirname, String &json, bool &first) {
  DIR *dir = opendir(dirname);
  if (!dir)
    return;

  struct dirent *entry;
  while ((entry = readdir(dir)) != NULL) {
    String entryName = String(entry->d_name);
    if (entryName == "." || entryName == "..")
      continue;

    String fullPath = String(dirname);
    if (!fullPath.endsWith("/"))
      fullPath += "/";
    fullPath += entryName;

    struct stat st;
    if (stat(fullPath.c_str(), &st) == 0) {
      if (S_ISDIR(st.st_mode)) {
        if (!first)
          json += ",";
        json += "{\"name\":\"" + fullPath + "\",\"size\":0,\"isDir\":true}";
        first = false;
        _listDirRecursive(fullPath.c_str(), json, first);
      } else {
        if (!first)
          json += ",";
        json += "{\"name\":\"" + fullPath +
                "\",\"size\":" + String((uint32_t)st.st_size) +
                ",\"isDir\":false}";
        first = false;
      }
    }
  }
  closedir(dir);
}

String Portal::_listFiles() {
  String json = "[";
  bool first = true;
  _listDirRecursive(SD_MOUNT_POINT, json, first);
  json += "]";
  return json;
}

void Portal::_deleteRecursive(String path) {
  DIR *dir = opendir(path.c_str());
  if (!dir) {
    remove(path.c_str());
    return;
  }

  struct dirent *entry;
  while ((entry = readdir(dir)) != NULL) {
    String entryName = String(entry->d_name);
    if (entryName == "." || entryName == "..")
      continue;

    String fullPath = path + "/" + entryName;
    struct stat st;
    if (stat(fullPath.c_str(), &st) == 0) {
      if (S_ISDIR(st.st_mode)) {
        _deleteRecursive(fullPath);
      } else {
        remove(fullPath.c_str());
      }
    }
  }
  closedir(dir);
  rmdir(path.c_str());
}

// --- Route Handlers ---

void Portal::_handleListFiles(AsyncWebServerRequest *request) {
  String content = _listFiles();
  request->send(200, "application/json", content);
}

void Portal::_handleFileGetAction(AsyncWebServerRequest *request) {
  if (request->hasParam("name")) {
    String fileName = request->getParam("name")->value();
    int lastSlash = fileName.lastIndexOf('/');
    String shortName =
        (lastSlash != -1) ? fileName.substring(lastSlash + 1) : fileName;
    AsyncVFSResponse *response = new AsyncVFSResponse(
        fileName, "application/octet-stream", true, shortName);
    request->send(response);
  } else {
    request->send(400, "text/plain", "Bad Request");
  }
}

void Portal::_handleFileDeleteAction(AsyncWebServerRequest *request) {
  if (request->hasParam("name")) {
    String fileName = request->getParam("name")->value();
    struct stat st;
    if (stat(fileName.c_str(), &st) == 0) {
      if (S_ISDIR(st.st_mode)) {
        _deleteRecursive(fileName);
        request->send(200, "text/plain", "Folder Deleted");
      } else {
        if (remove(fileName.c_str()) == 0)
          request->send(200, "text/plain", "File Deleted");
        else
          request->send(500, "text/plain", "Delete Failed");
      }
    } else {
      request->send(404, "text/plain", "Not Found");
    }
  } else {
    request->send(400, "text/plain", "Bad Request");
  }
}

void Portal::_handleMkdir(AsyncWebServerRequest *request) {
  if (request->hasParam("path")) {
    String path = request->getParam("path")->value();

    if (!path.startsWith(SD_MOUNT_POINT)) {
      if (!path.startsWith("/"))
        path = "/" + path;
      path = String(SD_MOUNT_POINT) + path;
    }
    if (path.endsWith("/") && path.length() > 1)
      path = path.substring(0, path.length() - 1);

    struct stat st;
    if (stat(path.c_str(), &st) == 0 && S_ISDIR(st.st_mode)) {
      request->send(200, "text/plain", "Exists");
      return;
    }

    if (mkdir(path.c_str(), 0777) == 0) {
      request->send(200, "text/plain", "Created");
    } else {
      Serial.printf("MKDIR Failed: %d\n", errno);
      request->send(500, "text/plain", "Failed");
    }
  } else {
    request->send(400, "text/plain", "Missing path");
  }
}

void Portal::_handleReboot(AsyncWebServerRequest *request) {
  request->send(200, "text/plain", "Rebooting...");
  _shouldReboot = true;
}

void Portal::_handleUpload(AsyncWebServerRequest *request, String filename,
                           size_t index, uint8_t *data, size_t len,
                           bool final) {
  if (index == 0) {
    _uploadStartTime = millis();
    _bufferOffset = 0;

    if (_uploadBuffer) {
      free(_uploadBuffer);
      _uploadBuffer = NULL;
    }
    _uploadBuffer = (uint8_t *)malloc(UPLOAD_BUFFER_SIZE);

    if (!_uploadBuffer) {
      Serial.println("Upload Failed: Out of Memory");
      return;
    }

    String folder = "/";
    if (request->hasParam("folder", true))
      folder = request->getParam("folder", true)->value();
    else if (request->hasParam("folder"))
      folder = request->getParam("folder")->value();

    String fullPath;
    if (folder.startsWith(SD_MOUNT_POINT)) {
      fullPath = folder + "/" + filename;
    } else {
      if (!folder.startsWith("/"))
        folder = "/" + folder;
      if (folder == "/")
        folder = "";
      fullPath = String(SD_MOUNT_POINT) + folder + "/" + filename;
    }

    while (fullPath.indexOf("//") != -1)
      fullPath.replace("//", "/");

    Serial.printf("SD Upload Start: %s\n", fullPath.c_str());
    _uploadFile = fopen(fullPath.c_str(), "w");
  }

  if (len > 0 && _uploadFile && _uploadBuffer) {
    for (size_t i = 0; i < len; i++) {
      _uploadBuffer[_bufferOffset++] = data[i];
      if (_bufferOffset >= UPLOAD_BUFFER_SIZE) {
        fwrite(_uploadBuffer, 1, UPLOAD_BUFFER_SIZE, _uploadFile);
        _bufferOffset = 0;
      }
    }
  }

  if (final) {
    if (_uploadFile) {
      if (_bufferOffset > 0)
        fwrite(_uploadBuffer, 1, _bufferOffset, _uploadFile);
      fclose(_uploadFile);
      _uploadFile = NULL;
    }
    if (_uploadBuffer) {
      free(_uploadBuffer);
      _uploadBuffer = NULL;
    }
    request->send(200, "text/plain", "Upload Complete");
  }
}

void Portal::persistStats() {
  uint64_t freeBytes = 0, usedBytes = 0, totalBytes = 0;
  float temp, hum;
  sdcard_get_stats(&totalBytes, &usedBytes, &freeBytes);
  float freeVal, usedVal, totalVal;
  char freeUnit[3], usedUnit[3], totalUnit[3];

  Utils::formatStorage(freeBytes, freeVal, freeUnit);
  Utils::formatStorage(usedBytes, usedVal, usedUnit);
  Utils::formatStorage(totalBytes, totalVal, totalUnit);

  if (shtc3 != NULL) {
    // Read actual data from the sensor
    shtc3_data_t data = shtc3->readTempHumi();
    temp = data.Temp;
    hum = data.RH;
  } else {
    // Fallback if init failed
    temp = 0.0;
    hum = 0.0;
  }

  // Format values (e.g., "22.5°C", "45%")
  String tStr = String(temp, 1) + "°C";
  String hStr = String(hum, 0) + "%";

  int batLevel = this->userdata->getBatteryPercentage();
  Serial.printf("Battery Level: %d", batLevel);
  Serial.println("%");

  String isCharging = this->userdata->getChargingStatus() ? "true" : "false";

  // Manually construct JSON to avoid heavy library dependency for simple data
  String json = "{";
  json += "\"firmware\":\"" + String(FIRMWARE_VERSION) + "\",";
  json += "\"total-capacity\":\"" + String(totalVal) + totalUnit + "\",";
  json += "\"used-storage\":\"" + String(usedVal) + usedUnit + "\",";
  json += "\"free-storage\":\"" + String(freeVal) + freeUnit + "\",";
  json += "\"temperature\":\"" + tStr + "\",";
  json += "\"humidity\":\"" + hStr + "\",";
  json += "\"battery-level\":\"" + String(batLevel) + "%\",";
  json += "\"is-charging\":\"" + isCharging + "\"";
  json += "}";

  // Open file in Write mode (Overwrites previous content)
  File file = UserFS.open("/dynamic/system-stats.json", "w");
  if (file) {
    file.print(json);
    file.close();
  } else {
    // Optional: Attempt to mount if file open fails, or just log error
    Serial.println("Error: Could not open /system-stats.json");
  }
}

void Portal::updateVaultIndex(String newFilename, bool add) {
  File file = UserFS.open("/secret/vaults.json", "r");
  DynamicJsonDocument doc(2048);
  if (file) {
    deserializeJson(doc, file);
    file.close();
  } else {
    doc["vaults"].to<JsonArray>();
  }

  JsonArray vaults = doc["vaults"];
  bool found = false;
  int index = -1;

  for (int i = 0; i < vaults.size(); i++) {
    if (vaults[i].as<String>() == newFilename) {
      found = true;
      index = i;
      break;
    }
  }

  bool changed = false;
  if (add && !found) {
    vaults.add(newFilename);
    changed = true;
  } else if (!add && found) {
    vaults.remove(index);
    changed = true;
  }

  if (changed) {
    File outFile = UserFS.open("/secret/vaults.json", "w");
    if (outFile) {
      serializeJson(doc, outFile);
      outFile.close();
    }
  }
}

String Portal::generateSalt(int len) {
  String salt = "";
  const char charset[] =
      "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (int i = 0; i < len; i++) {
    salt += charset[random(0, 62)];
  }
  return salt;
}

// Simple XOR Encryption + Hex Encoding
String Portal::encryptString(String input, String key) {
  String output = "";
  if (key.length() == 0)
    return input;

  for (int i = 0; i < input.length(); i++) {
    char c = input[i] ^ key[i % key.length()];
    if (c < 16)
      output += "0";
    output += String(c, HEX);
  }
  return output;
}

// Simple Hex Decoding + XOR Decryption
String Portal::decryptString(String hexInput, String key) {
  if (key.length() == 0 || hexInput.length() % 2 != 0)
    return hexInput;
  String output = "";
  for (int i = 0; i < hexInput.length(); i += 2) {
    String hexByte = hexInput.substring(i, i + 2);
    char c = (char)strtol(hexByte.c_str(), NULL, 16);
    output += (char)(c ^ key[(i / 2) % key.length()]);
  }
  return output;
}

// Syncs the NVS plaintext password to the JSON file in encrypted form
void Portal::syncCredFile() {
  prefs.begin("vault", true); // Read-only mode
  String pass = prefs.getString("pass", "");
  String hint = prefs.getString("hint", "");
  prefs.end();

  if (pass.length() > 0) {
    // Encrypt
    String encryptedPass = encryptString(pass, vaultSalt);

    // Create JSON
    DynamicJsonDocument doc(1024);
    doc["encryptedToken"] = encryptedPass;
    doc["hint"] = hint;

    // Ensure dir exists
    if (!UserFS.exists("/secret"))
      UserFS.mkdir("/secret");

    // Write to file
    File file = UserFS.open("/secret/cred.json", FILE_WRITE);
    if (file) {
      serializeJson(doc, file);
      file.close();
      Serial.println("Vault: Sync complete. Cred file updated with new salt.");
    }
  }
}

void Portal::initVaultSecurity() {
  // 1. Generate Session Salt
  vaultSalt = generateSalt(12);

  // 2. Sync existing credentials (if any) to file with new salt
  syncCredFile();
}

String Portal::getVaultSalt() { return vaultSalt; }

bool Portal::isVaultAuthenticated(AsyncWebServerRequest *request) {
  if (!request->hasHeader("X-Vault-Token")) return false;
  String encryptedPass = request->getHeader("X-Vault-Token")->value();
  String decryptedPass = this->decryptString(encryptedPass, vaultSalt);

  prefs.begin("vault", true);
  String pass = prefs.getString("pass", "");
  prefs.end();

  if (pass.length() == 0) return false;
  return pass == decryptedPass;
}