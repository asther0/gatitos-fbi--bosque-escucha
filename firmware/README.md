# Receptor ESP32 y puente USB BESC v1

Firmware exclusivo del **ESP32 receptor clásico**, no del ESP32-CAM. El nodo de Bill captura audio/foto; el receptor transporta sin inferencia. El puente Python conserva captura real en disco, convierte PCM a WAV y llama al centro local `POST /api/raw`. El worker local puede analizar con modelos instalados; sin modelos queda bloqueado explícitamente, nunca fabrica detecciones.

## Compilar y cargar

Requiere Arduino CLI y `esp32:esp32@3.3.11`, placa `esp32:esp32:esp32`.

```sh
arduino-cli compile --fqbn esp32:esp32:esp32 --build-path /tmp/bosque-receiver-build firmware/receiver
arduino-cli upload --fqbn esp32:esp32:esp32 --port /dev/cu.usbserial-1140 --input-dir /tmp/bosque-receiver-build firmware/receiver
python3 -m pip install -r firmware/requirements.txt
```

Antes de sobrescribir otra placa: guardar toda la flash o, como mínimo, todos los sectores que van a cambiar según flash_args y NVS. En el receptor inspeccionado se preserva el primer1MiB, que cubre bootloader, particiones, NVS, OTA metadata y aplicación de898832bytes en0x10000; no usar imagen merged ni erase-all con un backup parcial. Verificar tamaño, MD5 contra flash y SHA256 local; conservar copia y manifest fuera Git. Las credenciales Wi-Fi se guardan en NVS del receptor; un backup de flash puede contener secretos y nunca debe versionarse.

## Configuración privada y ejecución

Crear fuera Git un JSON modo 0600 con claves `ssid` y `password`. El firmware se conecta como estación Wi-Fi 2,4 GHz; abre TCP 3333 en su IP asignada por el router. No cambia la red de la laptop.

```sh
python3 firmware/bridge.py --port /dev/cu.usbserial-1140 --wifi-config /ruta/privada/wifi.json
# Imprime heartbeat con wifi_connected, IP y puerto. Nunca contraseña.
python3 firmware/bridge.py --port /dev/cu.usbserial-1140 --url http://127.0.0.1:8765
```

`LOCAL_CENTER_TOKEN` o `local-center/data/.token` autoriza el POST. Puerto USB a **921600**, 8N1. El puente abre sin togglear DTR/RTS. ROM boot logs a 115200 pueden aparecer al arrancar y se descartan hasta encontrar trama válida. Logs propios del firmware son tramas STATUS, nunca texto mezclado con audio.

El router no necesita Internet. El nodo y receptor sí deben estar en la misma LAN. La laptop puede seguir en otra red: recibe por USB. Si la laptop está en la LAN del router, se puede probar un archivo **real**:

```sh
python3 firmware/send_capture.py clip.wav --host IP_DEL_RECEPTOR --node A01
```

Este emisor de diagnóstico no simula el ESP32-CAM y no confirma caudal del hardware de Bill.

## Contrato preciso para Bill

Una conexión TCP persistente del nodo al receptor, puerto 3333. TCP lleva las mismas tramas que USB. Todos los enteros **little endian**. Header fijo **52 bytes**; payload máximo **1024 bytes**; trailer CRC32 de 4 bytes. Python struct: `<4sBBBBIQHHIQ16s`.

| Offset | Tamaño | Campo |
|---|---:|---|
| 0 | 4 | ASCII `BESC` |
| 4 | 1 | Versión `1` |
| 5 | 1 | Kind: `1` PCM16, `2` JPEG, `3` JSON estado, `16` config Wi-Fi USB, `128` ACK |
| 6 | 1 | Flags: bit0 timestamp es Unix epoch ms válido; 0 = uptime/no reloj |
| 7 | 1 | Header length `52` |
| 8 | 4 | Secuencia uint32; misma secuencia para reintento |
| 12 | 8 | Capture ID uint64 aleatorio por captura; conservar al reintentar |
| 20 | 2 | Fragment index desde 0 |
| 22 | 2 | Fragment count 1..2048 |
| 24 | 4 | Payload length 0..1024 |
| 28 | 8 | Timestamp uint64 ms; constante para toda captura |
| 36 | 16 | Node ID ASCII `[A-Za-z0-9_-]`, máximo16, relleno NUL |
| 52 | N | Payload |
| 52+N | 4 | CRC32 IEEE del header+payload, equivalente `zlib.crc32`, LE |

Captura de audio = PCM **signed little endian 16 bit, mono, 16000 Hz**, sin header WAV en el cable. Recomendada ventana **3 segundos = 96000 bytes** para persistencia YAMNet; 2 s mínimo práctico. Dividir en fragmentos 1024; último puede ser menor. Captura JPEG = archivo completo `FFD8…FFD9`, también fragmentado. Máximo captura2 MiB. Kind/node/capture/count/timestamp/flags constantes por captura. Alternar audio y fotografía si hardware no soporta concurrencia; declarar intervalos ciegos.

**Stop-and-wait:** enviar un fragmento y esperar ACK antes del siguiente. ACK conserva sequence/capture/index/count/node y lleva payload de un byte: `0` persistido en disco; `2` rechazado/no persistido, reintentar tras corregir o esperar. CRC incorrecto se descarta sin ACK. Timeout recomendado3 s, máximo5 reintentos por conexión. Retener captura original y sus IDs hasta terminar; duplicados idénticos son idempotentes. Nunca interpretar ACK como análisis completado ni alerta enviada.

El receptor conserva un único fragmento pendiente (máximo1080 bytes), reenvía a USB cada2 s hasta ACK y no sigue leyendo TCP durante ese tiempo. TCP aporta backpressure. Si desaparece el cliente, una conexión nueva restablece el transporte; el emisor debe reintentar captura completa con IDs originales. Un único nodo TCP simultáneo en este MVP; no hay multiplexación multi-nodo.

El parser de Python soporta fragmentación de lectura, varias tramas juntas, ruido de arranque y CRC incorrecto. Guarda fragmentos por UUIDv5 derivado de node+capture, hace `fsync` antes de ACK, marca captura completa solo tras recibir todas las partes. Un worker separado sube a `/api/raw`; conserva archivos y reintenta cada5 s si centro no responde. La respuesta del centro queda en `uploaded.json`. El spool predeterminado `~/.bosque-escucha/serial-spool` es privado y no está en Git. **La retención de disco debe limpiarse según el piloto**; se limita memoria/captura pero no hay borrado automático del archivo histórico.

Config USB kind16 = `SSID UTF8 + byte NUL + PASSWORD UTF8`, sin JSON en el payload; ssid1..32 bytes, password0..63. `bridge.py --wifi-config` convierte el JSON privado a este formato. Estado kind3 muestra conectividad real y dirección IP; no contiene secretos. TCP sin TLS y provisioning USB son para LAN controlada del prototipo; no exponer3333 a Internet.

## Validación focalizada

```sh
python3 -m unittest discover -s firmware -p test_protocol.py
```

Cinco pruebas: todas las posiciones de corte de frame, CRC/ruido, tramas concatenadas/ACK, reensamblado durable fuera de orden/duplicados y límite de captura. Compilar valida firmware contra SDK real. La velocidad USB de921600 requiere medición física con tráfico y el nodo de Bill. La cifra teórica92160 bytes/s no es una medición.

### Diagnóstico USB aislado

`python3 firmware/serial_benchmark.py --port /dev/cu.usbserial-1140` envía96 tramas de prueba con1024 bytes aleatorios y verifica eco, secuencia y CRC. Kind17 solicita eco; respuesta kind129 conserva payload y header salvo tipo/CRC. No crea capturas, no llama HTTP ni IA. La tasa informada es payload de ida por tiempo de ida/vuelta stop-and-wait, no equivale a caudal Wi-Fi→USB. Ejecutarlo con el puente detenido para tener un único dueño del puerto.
