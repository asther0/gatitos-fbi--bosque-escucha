# ESP32-CAM: diagnóstico de captura

Este sketch usa el pinout AI Thinker, inicializa el sensor, y entrega una foto JPEG por USB serial al recibir `C`. No usa Wi‑Fi ni credenciales. En esta placa el sensor llegó a identificarse como OV3660 (`PID 0x3660`) y produjo JPEG VGA, aunque las lecturas posteriores fueron intermitentes y la escena salió casi uniforme. Aún falta resolver contacto/alimentación y confirmar imagen óptica útil.

## Compilar y cargar

La carga reemplaza la aplicación de la placa. Conserva un respaldo completo antes de usarla. Compila con:

```sh
arduino-cli compile --fqbn esp32:esp32:esp32 firmware/camera_test
```

Usa Arduino IDE/CLI para cargarla a la placa conectada. Si escribes con esptool, escribe solo el binario de aplicación en `0x10000`; no borres toda la flash ni sobrescribas la tabla de particiones.

## Capturar

```sh
python3 firmware/camera_test/capture.py --port /dev/cu.usbserial-A5069RR4 --out /tmp/esp32cam-capture.jpg
```

Una captura válida empieza con los bytes JPEG `FFD8` y termina con `FFD9`. El LED blanco de la placa se activa brevemente durante la captura. Para obtener una imagen útil, libera el lente, apunta a una escena iluminada y usa una fuente de 5 V estable con tierra compartida con el adaptador USB‑UART.
