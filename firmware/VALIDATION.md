# Validación del receptor · 2026-10-17

## Compilación y pruebas

- Chip físico: ESP32-D0WD-V3 revisión3.1; flash4MiB; crystal40MHz; MAC `b4:bf:e9:61:cf:e4`; puerto `/dev/cu.usbserial-1140`.
- Arduino core `esp32:esp32@3.3.11`, FQBN `esp32:esp32:esp32`: compilación exit0,898680 bytes programa (68%),49992 bytes RAM global (15%). Imagen aplicación898832 bytes.
- `python3 -m unittest discover -s firmware -p test_protocol.py`:6 pruebas pasan, incluidos heartbeat sin confundir receptor con árbol.
- `python3 -m py_compile firmware/*.py`:exit0.

## Backup recuperable antes de escribir

La lectura completa4MiB falló: a921600 en conexión; a460800 tras4096 bytes; a115200 al99% por bloque corrupto (esperaba4096, recibió4086). Ninguno de esos intentos se usó como respaldo.

Se respaldó después **primer1MiB completo** en16 segmentos64KiB. Cada segmento comparó su MD5 con MD5 calculado directamente por la flash antes de guardarse. Manifest incluye offset/longitud/hash; SHA256 del conjunto:

`0729e9c4391442e205b7bd3dede3042dca19067c54deb856ce2313dde805def0`

Ubicación privada: `~/.bosque-escucha/backups/receiver-preflash-20261017/first-1MiB.bin` y `manifest.json`. Directorio0700, archivos0600. No contienen archivos públicos ni están en Git.

Ese rango contiene todos los sectores modificados y NVS: bootloader0x1000..0x7fff, tabla0x8000..0x8fff, NVS0x9000..0xdfff, OTA metadata0xe000..0xffff, app0x10000..0xebfff. Resto de flash no se modificó por el comando. No se usó erase-all ni merged image.

## Firmware cargado físicamente

`esptool write-flash` a115200 con offsets explícitos0x1000,0x8000,0xe000,0x10000 completó exit0 y verificó hash de cada escritura. Aplicación tomó57.4s. El ESP32 tiene el receptor BESCv1 compilado.

Boot capturado a115200 tras reset RTS: `rst:0x1 (POWERON_RESET), boot:0x13 (SPI_FAST_FLASH_BOOT)`, modoDIO, carga tres segmentos, `entry 0x400805b4`. No se observó brownout, panic ni download-mode en esa captura.

## Bloqueo físico observado

- Prueba eco a921600:0 tramas válidas, timeout3s en fragmento0; sin payload confirmado.
- Provisioning Wi-Fi por USB terminó sin confirmar asociación. **No hay IP de router confirmada.**
- Después de reset RTS explícito, lectura11s a921600 recibió1165 bytes, cero magic `BESC`, cero tramas válidas. Prefijo `c0c000c000c0c0c000c0000000c000c0…`.
- Único retry de eco tras ese reset:0 tramas, timeout3.102s en fragmento0; no validó payload.

La programación verificada y el arranque funcionan; el transporte de aplicación a921600 permanece **no validado por datos corruptos**. No atribuir causa exacta sin probar adaptador/cable/driver o velocidad alternativa. A115200 el máximo teórico11520 bytes/s no alcanza PCM mono16k16bit32000 bytes/s. No se rebajó silenciosamente el requisito ni se afirmó audio funcionando.

## Siguiente prueba física

Revisar adaptador USB-UART/driver/cable y conseguir eco BESC a921600 sin corrupción; luego provisionar router y confirmar IP por STATUS. Finalmente conectar nodo de Bill, enviar WAV/JPEG real y medir Wi-Fi→USB→`/api/raw`. No se probó todavía audio/micrófono, cámara, inferencia ni WhatsApp a través de este receptor. El puerto se deja cerrado, sin bridge activo.

## Restauración si fuera necesaria

Con placa en bootloader y enlace115200 estable, escribir únicamente el respaldo1MiB en offset0 usando esptool. Esto restaura todos los sectores que se modificaron, incluidos NVS; no usar erase-all. El respaldo es específico de esta placa y puede contener secretos.
