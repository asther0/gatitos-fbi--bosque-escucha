# ESP32 + INMP441 por Wi-Fi al centro local

Este firmware conserva la conexión validada: `3V3→VDD`, `GND→GND/L/R`, `D25→SCK`, `D26→WS`, `D33→SD`. `R` graba un WAV de 3 segundos por USB; `W` graba y lo sube por Wi-Fi al `POST /api/raw` del centro local. `E` activa el envío cada 5 segundos y `D` lo detiene. Tras reiniciar, la escucha queda apagada hasta pulsar **Activar escucha** en la Mac. La inferencia YAMNet corre en la laptop, no en el ESP32.

1. Conectar **laptop y ESP32 a la misma red local del TP-Link**. El ESP32 clásico necesita el SSID de **2,4 GHz**; la laptop puede usar esa misma banda. El TP-Link puede operar sin WAN. Desactivar aislamiento de clientes/AP isolation si está activo.
2. En la laptop, obtener la IP de Wi-Fi: `ipconfig getifaddr en0`. Iniciar `local-center/run.py --host ESA_IP`; el servidor solo escucha en esa interfaz. El token privado `local-center/data/.token` es obligatorio para subir capturas.
3. Cargar `arduino-cli upload -p /dev/cu.usbserial-130 --fqbn esp32:esp32:esp32:UploadSpeed=115200 firmware/mic_wifi`. Si la red ya está configurada en NVS, la placa se reconecta sola.
4. Configurar por USB con `python3 firmware/mic_wifi/provision.py --ssid NOMBRE_DE_LA_RED --test`. El script solicita la contraseña sin eco, toma el token del centro local y la IP actual de `en0`, y confirma `WIFI_CONNECTED` y `UPLOAD_OK status=200`. El nodo de prueba es `DEMO-ESP32-WIFI`; sus capturas reproducidas no se presentan como actividad del bosque ni envían alertas externas.
5. Comprobar la captura en `http://ESA_IP:8765` y el nodo DEMO en Command Center con **Ver datos de prueba**. Cuando la prueba manual funcione, ejecutar el configurador con `--auto` para activar envíos cada 5 s; también admite `D` por serial para detenerlos. No usar el modo automático con la laptop ausente: las capturas fallidas no se almacenan en el ESP32 para reintento.

El enlace es HTTP dentro de una LAN controlada, con token Bearer. No reenviar el puerto 8765 a Internet. Si macOS pregunta si permite conexiones entrantes al proceso Python, permitirlo para esta red. Si la laptop cambia de IP, volver a ejecutar `provision.py` con la IP nueva.

El iniciador gráfico `Iniciar MVP.command` evita los comandos manuales. El protocolo 2 admite `H\tIP\n`: actualiza solo la dirección del centro, conservando red, clave y token en NVS. Antes de una captura, el panel comprueba que la IP del ESP32 esté en la subred Wi-Fi de la Mac y actualiza el destino si DHCP cambió la IP de la laptop. Cuando la Mac está en otra red, no modifica el destino.
