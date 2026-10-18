#include <Arduino.h>
#include "esp_camera.h"

// Pin map validated against an ESP32-CAM board reporting sensor PID 0x3660.
// This serial diagnostic avoids Wi-Fi credentials and sends one JPEG on `C`.
static constexpr int PWDN_GPIO_NUM = 32;
static constexpr int RESET_GPIO_NUM = -1;
static constexpr int XCLK_GPIO_NUM = 0;
static constexpr int SIOD_GPIO_NUM = 26;
static constexpr int SIOC_GPIO_NUM = 27;
static constexpr int Y9_GPIO_NUM = 35;
static constexpr int Y8_GPIO_NUM = 34;
static constexpr int Y7_GPIO_NUM = 39;
static constexpr int Y6_GPIO_NUM = 36;
static constexpr int Y5_GPIO_NUM = 21;
static constexpr int Y4_GPIO_NUM = 19;
static constexpr int Y3_GPIO_NUM = 18;
static constexpr int Y2_GPIO_NUM = 5;
static constexpr int VSYNC_GPIO_NUM = 25;
static constexpr int HREF_GPIO_NUM = 23;
static constexpr int PCLK_GPIO_NUM = 22;
static constexpr int FLASH_GPIO_NUM = 4;

void setup() {
  Serial.begin(115200);
  delay(1000);

  camera_config_t cfg = {};
  cfg.ledc_channel = LEDC_CHANNEL_0;
  cfg.ledc_timer = LEDC_TIMER_0;
  cfg.pin_d0 = Y2_GPIO_NUM;
  cfg.pin_d1 = Y3_GPIO_NUM;
  cfg.pin_d2 = Y4_GPIO_NUM;
  cfg.pin_d3 = Y5_GPIO_NUM;
  cfg.pin_d4 = Y6_GPIO_NUM;
  cfg.pin_d5 = Y7_GPIO_NUM;
  cfg.pin_d6 = Y8_GPIO_NUM;
  cfg.pin_d7 = Y9_GPIO_NUM;
  cfg.pin_xclk = XCLK_GPIO_NUM;
  cfg.pin_pclk = PCLK_GPIO_NUM;
  cfg.pin_vsync = VSYNC_GPIO_NUM;
  cfg.pin_href = HREF_GPIO_NUM;
  cfg.pin_sccb_sda = SIOD_GPIO_NUM;
  cfg.pin_sccb_scl = SIOC_GPIO_NUM;
  cfg.pin_pwdn = PWDN_GPIO_NUM;
  cfg.pin_reset = RESET_GPIO_NUM;
  cfg.xclk_freq_hz = 20000000;
  cfg.pixel_format = PIXFORMAT_JPEG;
  cfg.frame_size = FRAMESIZE_VGA;
  cfg.jpeg_quality = 12;
  cfg.fb_count = 1;
  cfg.fb_location = CAMERA_FB_IN_DRAM;
  cfg.grab_mode = CAMERA_GRAB_WHEN_EMPTY;

  const esp_err_t err = esp_camera_init(&cfg);
  if (err != ESP_OK) {
    Serial.printf("CAMERA_INIT_FAILED 0x%x\n", err);
    return;
  }

  sensor_t *sensor = esp_camera_sensor_get();
  if (sensor && sensor->id.PID == OV3660_PID) {
    sensor->set_vflip(sensor, 1);
    sensor->set_brightness(sensor, 1);
    sensor->set_saturation(sensor, -2);
  }
  pinMode(FLASH_GPIO_NUM, OUTPUT);
  digitalWrite(FLASH_GPIO_NUM, LOW);
  Serial.printf("CAMERA_READY sensor_pid=0x%04x; send C to capture\n", sensor ? sensor->id.PID : 0);
}

void loop() {
  if (Serial.available() && Serial.read() == 'C') {
    digitalWrite(FLASH_GPIO_NUM, HIGH);
    delay(350);
    camera_fb_t *frame = esp_camera_fb_get();
    digitalWrite(FLASH_GPIO_NUM, LOW);
    if (!frame) {
      Serial.println("CAPTURE_FAILED");
      return;
    }

    Serial.printf("FRAME:%u\n", static_cast<unsigned>(frame->len));
    Serial.write(frame->buf, frame->len);
    Serial.println();
    Serial.flush();
    esp_camera_fb_return(frame);
    Serial.println("CAPTURE_DONE");
  }
  delay(10);
}
