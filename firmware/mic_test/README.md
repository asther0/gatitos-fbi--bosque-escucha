# Prueba física del INMP441 en ESP32 DevKit

Con la placa de la foto (USB arriba), conectar `3V3→VDD`, `GND→GND`, `D25→SCK`, `D26→WS`, `D33→SD` y `GND→L/R`. `D25`, `D26` y `D33` corresponden a GPIO25, GPIO26 y GPIO33. Usar solo 3,3 V para el micrófono.

El sketch lee I²S mono izquierdo a 16 kHz y muestra cada medio segundo el número de muestras, las muestras distintas de cero, el nivel RMS y los extremos. Para repetir:

```sh
arduino-cli compile --fqbn esp32:esp32:esp32 --build-path /tmp/bosque-mic-test-build firmware/mic_test
arduino-cli upload --fqbn esp32:esp32:esp32 --port /dev/cu.usbserial-130 --input-dir /tmp/bosque-mic-test-build firmware/mic_test
arduino-cli monitor --port /dev/cu.usbserial-130 --config baudrate=115200
```

Para grabar y escuchar una prueba de voz, cerrar primero el monitor con Ctrl+C y ejecutar desde la raíz del proyecto:

```sh
python3 firmware/mic_test/record.py
afplay .local/microfono-prueba.wav
```

Después de la cuenta regresiva, decir «Bosque Escucha, uno, dos, tres» a 20–30 cm del micrófono. El script captura dos segundos, ajusta el volumen y guarda WAV mono de 16 bits a 16 kHz. Se verificó una captura de control de dos segundos con 32 000 muestras y encabezado WAV válido.

La carga reemplaza temporalmente la aplicación receptora. El 18 de octubre de 2026 se respaldaron la aplicación exacta y NVS/OTA en `~/.bosque-escucha/backups/receiver-mic-test-20261018/` (archivos privados). Solo se escribió la aplicación en `0x10000`; NVS no se modificó. Para restaurar el receptor de esa placa, escribir `app.bin` en `0x10000` con esptool a 115200, sin borrar toda la flash. No usar ese respaldo en otra placa.

Resultado inicial en `/dev/cu.usbserial-130`, MAC `b4:bf:e9:61:cf:e4`: I²S inició, unas 8192 muestras por ventana de 0,5 s, casi todas distintas de cero; RMS de fondo aproximado 300–500 ppm de escala completa y picos transitorios de 1013–1954 ppm. Esto confirma que la entrada digital entrega una señal variable; falta guardar y escuchar una grabación para evaluar calidad acústica.
