# Validación del receptor · 2026-10-17

## Hecho

- Puerto físico `/dev/cu.usbserial-1140` respondió a `esptool flash-id`.
- Chip: ESP32-D0WD-V3 revisión3.1; flash4MiB; crystal40MHz; MAC `b4:bf:e9:61:cf:e4`.
- Compilación Arduino core `esp32:esp32@3.3.11`, FQBN `esp32:esp32:esp32` exit0:898680 bytes programa (68%),49992 bytes RAM global (15%).
- `python3 -m unittest discover -s firmware -p test_protocol.py`:5 pruebas pasan.
- `python3 -m py_compile firmware/*.py`:exit0.

## Observación física

Lectura de backup a921600 falló en conexión flash; a460800 falló tras4096 bytes con ruido/corrupción serie. Backup a115200 progresó estable. Estas velocidades de esptool no equivalen a medir el puente del firmware, pero exigen comprobar el enlace antes de afirmar audio sostenido.

## Pendiente

Completar backup verificado antes de flashear; provisionar Wi-Fi; medir eco USB; probar LAN real desde el nodo de Bill. No se ha medido todavía captura de micrófono/cámara, análisis ni envío WhatsApp mediante este receptor.
