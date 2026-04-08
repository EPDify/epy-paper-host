#ifndef WIFI_MANAGER_H
#define WIFI_MANAGER_H

String Wifi_Init();
void processDNSrequests(void);
String escapeJsonString(String input);
String testWiFiConnection(String ssid, String password);

#endif