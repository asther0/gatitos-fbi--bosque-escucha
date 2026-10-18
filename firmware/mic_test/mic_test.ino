// INMP441 diagnostic for the ESP32 DevKit receiver board.
// Wiring: 3V3->VDD, GND->GND and L/R, D25->SCK, D26->WS, D33->SD.
#include <Arduino.h>
#include <ESP_I2S.h>
#include <math.h>

I2SClass mic;
int32_t samples[256];
uint32_t windowStart = 0;
uint32_t count = 0;
uint32_t nonzero = 0;
int32_t minimum = INT32_MAX;
int32_t maximum = INT32_MIN;
double sumSquares = 0;

void captureWav() {
  constexpr uint32_t SAMPLE_RATE = 16000;
  constexpr uint32_t SECONDS = 2;
  constexpr uint32_t SAMPLE_COUNT = SAMPLE_RATE * SECONDS;
  int16_t *pcm = static_cast<int16_t *>(malloc(SAMPLE_COUNT * sizeof(int16_t)));
  if (!pcm) {
    Serial.println("MIC_CAPTURE_ERROR no_memory");
    return;
  }
  uint32_t recorded = 0;
  while (recorded < SAMPLE_COUNT) {
    size_t bytes = mic.readBytes(reinterpret_cast<char *>(samples), sizeof(samples));
    if (bytes == 0) {
      free(pcm);
      Serial.println("MIC_CAPTURE_ERROR read_failed");
      return;
    }
    for (size_t i = 0; i < bytes / sizeof(samples[0]) && recorded < SAMPLE_COUNT; ++i) {
      pcm[recorded++] = static_cast<int16_t>(samples[i] >> 16);
    }
  }
  Serial.printf("MIC_CAPTURE_BEGIN bytes=%lu rate=%lu\n",
                static_cast<unsigned long>(SAMPLE_COUNT * sizeof(int16_t)),
                static_cast<unsigned long>(SAMPLE_RATE));
  Serial.write(reinterpret_cast<const uint8_t *>(pcm), SAMPLE_COUNT * sizeof(int16_t));
  Serial.println("\nMIC_CAPTURE_END");
  free(pcm);
  windowStart = millis();
  count = nonzero = 0;
  minimum = INT32_MAX;
  maximum = INT32_MIN;
  sumSquares = 0;
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("MIC_TEST start: SCK=D25 WS=D26 SD=D33 L/R=GND");
  mic.setPins(25, 26, -1, 33);
  if (!mic.begin(I2S_MODE_STD, 16000, I2S_DATA_BIT_WIDTH_32BIT,
                 I2S_SLOT_MODE_MONO, I2S_STD_SLOT_LEFT)) {
    Serial.printf("MIC_TEST I2S_INIT_FAILED error=%d\n", mic.lastError());
    return;
  }
  Serial.println("MIC_TEST I2S_READY sample_rate=16000 slot=left");
  windowStart = millis();
}

void loop() {
  if (!mic.rxChan()) {
    delay(1000);
    return;
  }
  if (Serial.available()) {
    if (Serial.read() == 'R') captureWav();
  }
  size_t bytes = mic.readBytes(reinterpret_cast<char *>(samples), sizeof(samples));
  if (bytes == 0) {
    Serial.printf("MIC_TEST READ_FAILED error=%d\n", mic.lastError());
    delay(250);
    return;
  }
  for (size_t i = 0; i < bytes / sizeof(samples[0]); ++i) {
    int32_t value = samples[i];
    if (value < minimum) minimum = value;
    if (value > maximum) maximum = value;
    if (value != 0) ++nonzero;
    double scaled = static_cast<double>(value) / 2147483648.0;
    sumSquares += scaled * scaled;
    ++count;
  }
  if (millis() - windowStart >= 500 && count) {
    double rms = sqrt(sumSquares / count);
    Serial.printf("MIC_TEST samples=%lu nonzero=%lu rms_ppm=%.0f min=%ld max=%ld\n",
                  static_cast<unsigned long>(count),
                  static_cast<unsigned long>(nonzero), rms * 1000000.0,
                  static_cast<long>(minimum), static_cast<long>(maximum));
    windowStart = millis();
    count = nonzero = 0;
    minimum = INT32_MAX;
    maximum = INT32_MIN;
    sumSquares = 0;
  }
}
