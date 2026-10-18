// ESP32 DevKit + INMP441: 3V3->VDD, GND->GND/L/R, D25->SCK, D26->WS, D33->SD.
// Capture 3 s WAV and upload over the TP-Link LAN to local-center /api/raw.
// Provision over USB with provision.py; credentials never appear in serial logs.
#include <Arduino.h>
#include <ESP_I2S.h>
#include <Preferences.h>
#include <WiFi.h>

constexpr uint32_t RATE = 16000;
constexpr uint32_t SAMPLE_COUNT = RATE * 3;
constexpr uint32_t PCM_BYTES = SAMPLE_COUNT * sizeof(int16_t);
constexpr uint32_t AUTO_INTERVAL_MS = 5000;

I2SClass mic;
Preferences prefs;
String wifiSsid, wifiPassword, centerHost, centerToken, nodeId;
bool configured = false;
bool autoUpload = false;
uint32_t lastUpload = 0;

bool writeAll(WiFiClient &client, const uint8_t *data, size_t length) {
  size_t sent = 0;
  while (sent < length) {
    size_t n = client.write(data + sent, min(size_t(1024), length - sent));
    if (!n) return false;
    sent += n;
  }
  return true;
}

void wavHeader(uint8_t header[44]) {
  memset(header, 0, 44);
  memcpy(header, "RIFF", 4);
  uint32_t size = PCM_BYTES + 36;
  memcpy(header + 4, &size, 4);
  memcpy(header + 8, "WAVEfmt ", 8);
  uint32_t fmtSize = 16;
  memcpy(header + 16, &fmtSize, 4);
  uint16_t format = 1, channels = 1, align = 2, depth = 16;
  uint32_t bytesPerSecond = RATE * 2;
  memcpy(header + 20, &format, 2);
  memcpy(header + 22, &channels, 2);
  memcpy(header + 24, &RATE, 4);
  memcpy(header + 28, &bytesPerSecond, 4);
  memcpy(header + 32, &align, 2);
  memcpy(header + 34, &depth, 2);
  memcpy(header + 36, "data", 4);
  uint32_t dataSize = PCM_BYTES;
  memcpy(header + 40, &dataSize, 4);
}

bool capture(int16_t *pcm) {
  int32_t block[256];
  uint32_t recorded = 0;
  uint32_t histogram[256] = {};
  while (recorded < SAMPLE_COUNT) {
    size_t bytes = mic.readBytes(reinterpret_cast<char *>(block), sizeof(block));
    if (!bytes) return false;
    for (size_t i = 0; i < bytes / sizeof(block[0]) && recorded < SAMPLE_COUNT; ++i) {
      int16_t value = static_cast<int16_t>(block[i] >> 16);
      pcm[recorded++] = value;
      histogram[min(255, abs(int(value)) / 128)]++;
    }
  }
  // Match the USB recorder's robust gain: target the 99.5th percentile.
  uint32_t cumulative = 0;
  int percentile = 1;
  for (int bucket = 0; bucket < 256; ++bucket) {
    cumulative += histogram[bucket];
    if (cumulative >= SAMPLE_COUNT * 995 / 1000) {
      percentile = max(1, bucket * 128);
      break;
    }
  }
  float gain = min(100.0f, 12000.0f / percentile);
  for (uint32_t i = 0; i < SAMPLE_COUNT; ++i) {
    pcm[i] = int16_t(constrain(int32_t(pcm[i] * gain), -32768, 32767));
  }
  return true;
}

bool wifiReady() {
  if (!configured) return false;
  if (WiFi.status() == WL_CONNECTED) return true;
  WiFi.begin(wifiSsid.c_str(), wifiPassword.c_str());
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 12000) delay(200);
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WIFI_DISCONNECTED");
    return false;
  }
  Serial.print("WIFI_CONNECTED ip=");
  Serial.println(WiFi.localIP());
  return true;
}

void sendCapture() {
  if (!wifiReady()) return;
  int16_t *pcm = static_cast<int16_t *>(malloc(PCM_BYTES));
  if (!pcm) {
    Serial.println("CAPTURE_ERROR no_memory");
    return;
  }
  if (!capture(pcm)) {
    Serial.println("CAPTURE_ERROR i2s_read");
    free(pcm);
    return;
  }
  WiFiClient client;
  client.setTimeout(15000);
  if (!client.connect(centerHost.c_str(), 8765)) {
    Serial.println("UPLOAD_ERROR center_unreachable");
    free(pcm);
    return;
  }
  const String boundary = "bosqueesp32audio";
  String prefix = "--" + boundary + "\r\nContent-Disposition: form-data; name=\"node_id\"\r\n\r\n" +
                  nodeId + "\r\n--" + boundary +
                  "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"esp32-mic.wav\"\r\n" +
                  "Content-Type: audio/wav\r\n\r\n";
  String suffix = "\r\n--" + boundary + "--\r\n";
  uint32_t contentLength = prefix.length() + 44 + PCM_BYTES + suffix.length();
  client.print("POST /api/raw HTTP/1.1\r\nHost: " + centerHost +
               "\r\nAuthorization: Bearer " + centerToken +
               "\r\nContent-Type: multipart/form-data; boundary=" + boundary +
               "\r\nContent-Length: " + String(contentLength) +
               "\r\nConnection: close\r\n\r\n");
  uint8_t header[44];
  wavHeader(header);
  bool sent = writeAll(client, reinterpret_cast<const uint8_t *>(prefix.c_str()), prefix.length()) &&
              writeAll(client, header, 44) &&
              writeAll(client, reinterpret_cast<const uint8_t *>(pcm), PCM_BYTES) &&
              writeAll(client, reinterpret_cast<const uint8_t *>(suffix.c_str()), suffix.length());
  free(pcm);
  if (!sent) {
    Serial.println("UPLOAD_ERROR write_failed");
    client.stop();
    return;
  }
  String status = client.readStringUntil('\n');
  status.trim();
  if (status.indexOf(" 200 ") >= 0) Serial.println("UPLOAD_OK status=200");
  else Serial.println("UPLOAD_ERROR " + status.substring(0, 80));
  client.stop();
}

void sendUsbCapture() {
  int16_t *pcm = static_cast<int16_t *>(malloc(PCM_BYTES));
  if (!pcm) {
    Serial.println("MIC_CAPTURE_ERROR no_memory");
    return;
  }
  if (!capture(pcm)) {
    Serial.println("MIC_CAPTURE_ERROR i2s_read");
    free(pcm);
    return;
  }
  Serial.printf("MIC_CAPTURE_BEGIN bytes=%lu rate=%lu\n",
                static_cast<unsigned long>(PCM_BYTES), static_cast<unsigned long>(RATE));
  Serial.write(reinterpret_cast<const uint8_t *>(pcm), PCM_BYTES);
  Serial.println("\nMIC_CAPTURE_END");
  free(pcm);
}

void configure(String line) {
  // C\tSSID\tPASSWORD\tCENTER_IP\tTOKEN\tNODE_ID\n
  if (!line.startsWith("C\t")) return;
  String fields[5];
  int start = 2;
  for (int i = 0; i < 4; ++i) {
    int next = line.indexOf('\t', start);
    if (next < 0) {
      Serial.println("CONFIG_ERROR invalid_fields");
      return;
    }
    fields[i] = line.substring(start, next);
    start = next + 1;
  }
  fields[4] = line.substring(start);
  fields[4].trim();
  if (!fields[0].length() || !fields[2].length() || !fields[3].length() || !fields[4].length()) {
    Serial.println("CONFIG_ERROR empty_field");
    return;
  }
  wifiSsid = fields[0];
  wifiPassword = fields[1];
  centerHost = fields[2];
  centerToken = fields[3];
  nodeId = fields[4];
  prefs.putString("ssid", wifiSsid);
  prefs.putString("password", wifiPassword);
  prefs.putString("center", centerHost);
  prefs.putString("token", centerToken);
  prefs.putString("node", nodeId);
  configured = true;
  WiFi.disconnect();
  Serial.println("CONFIG_SAVED");
  wifiReady();
}

void setup() {
  Serial.begin(115200);
  Serial.setTimeout(1000);
  prefs.begin("bosque-mic", false);
  wifiSsid = prefs.getString("ssid", "");
  wifiPassword = prefs.getString("password", "");
  centerHost = prefs.getString("center", "");
  centerToken = prefs.getString("token", "");
  nodeId = prefs.getString("node", "DEMO-ESP32-WIFI");
  configured = wifiSsid.length() && centerHost.length() && centerToken.length();
  // Listening starts only after the operator presses the button in the Mac UI.
  autoUpload = false;
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  mic.setPins(25, 26, -1, 33);
  if (!mic.begin(I2S_MODE_STD, RATE, I2S_DATA_BIT_WIDTH_32BIT,
                 I2S_SLOT_MODE_MONO, I2S_STD_SLOT_LEFT)) {
    Serial.println("MIC_WIFI_ERROR i2s_init");
    return;
  }
  Serial.println("MIC_WIFI_READY I2S_READY pins=D25,D26,D33 rate=16000");
  if (configured) wifiReady();
}

void loop() {
  if (Serial.available()) {
    char command = Serial.read();
    if (command == 'C') configure(String("C") + Serial.readStringUntil('\n'));
    else if (command == 'H') {
      // Update the laptop address after DHCP changes, keeping Wi-Fi credentials.
      String host = Serial.readStringUntil('\n');
      host.trim();
      IPAddress address;
      if (!address.fromString(host) || !wifiSsid.length() || !centerToken.length()) {
        Serial.println("CENTER_ERROR invalid_config");
      } else {
        centerHost = host;
        prefs.putString("center", centerHost);
        configured = true;
        Serial.println("CENTER_UPDATED");
      }
    }
    else if (command == 'R') sendUsbCapture();
    else if (command == 'W') sendCapture();
    else if (command == 'A') {
      autoUpload = !autoUpload;
      lastUpload = millis();
      Serial.println(autoUpload ? "AUTO_ON interval=5s" : "AUTO_OFF");
    } else if (command == 'E') {
      autoUpload = true;
      lastUpload = millis();
      Serial.println("AUTO_ON interval=5s");
    } else if (command == 'D') {
      autoUpload = false;
      Serial.println("AUTO_OFF");
    } else if (command == 'S') {
      Serial.print("STATUS wifi=");
      Serial.print(WiFi.status() == WL_CONNECTED ? "connected" : "disconnected");
      Serial.print(" ip=");
      Serial.print(WiFi.localIP());
      Serial.print(" center=");
      Serial.print(centerHost);
      Serial.print(" auto=");
      Serial.print(autoUpload ? "on" : "off");
      Serial.println(" protocol=2");
    }
  }
  if (autoUpload && millis() - lastUpload >= AUTO_INTERVAL_MS) {
    lastUpload = millis();
    sendCapture();
  }
  delay(10);
}
