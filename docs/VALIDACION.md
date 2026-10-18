# Validación del MVP — 17 de octubre de 2026

## Verificado

| Circuito | Evidencia |
| --- | --- |
| Compilación | `npm run build` y TypeScript correctos; build de producción Vercel listo |
| Web pública | `https://bosque-escucha.vercel.app` responde 200; `/api/health` confirma acceso DB |
| Mapa | OpenStreetMap visible en navegador de producción; encabezado Referer corregido y plano local de respaldo disponible |
| Supabase | Cinco migraciones aplicadas; tablas con RLS y bucket privado |
| API operativa | Smoke contra localhost y Vercel: login, persistencia, UUID idempotente, correlación, prioridad humana preservada, transiciones y aprobación única |
| Privacidad | Público limitado a DEMO; evidencia deniega acceso anónimo; binarios servidos mediante URL firmada corta |
| Evidencias | WAV sintético subido dos veces conserva mismo path; reproducción privada recupera bytes originales |
| Offline → nube | WAV de control guardado en SQLite, analizado y sincronizado por worker a Supabase Storage; 96.044 bytes comprobados |
| Reconexión | Nube simulada falla después del upload; reintento de snapshot no vuelve a subir el archivo; primero se registra el nodo |
| Demos | Con webhook configurado en test, no se producen llamadas externas para demos, incluyendo trabajos antiguos |
| Modelos CPU | YOLO11n: imagen negra 320×240, cero personas. YAMNet: silencio 3 s, 521 clases, cero eventos objetivo |
| Hardware software | Firmware receptor compila con Arduino-ESP32 3.3.11; pruebas parser CRC, fragmentación, ACK, reensamblado y límites aprobadas |

Los datos generados por smoke cloud están etiquetados DEMO. El nodo `CHECK-LOCAL` es un control de integración de software, no un dispositivo físico; su WAV es silencio generado. Los controles de modelo no son una medición de sensibilidad ni falsos positivos en campo.

## Pendiente con el equipo

- Capturas positivas reales de cámara y micrófono de Bill; pinout, alimentación y concurrencia física.
- Medición sostenida nodo Wi-Fi → receptor → USB y pérdidas. Estado detallado del receptor en [firmware/VALIDATION.md](../firmware/VALIDATION.md).
- Veinte ensayos variados y tiempo real desde captura hasta incidente, según el PRD.
- Corte real de WAN con el router local encendido.
- Instancia n8n/proveedor WhatsApp, destinatario acordado y ciclo de entrega/confirmación. No se enviaron mensajes externos.

No se implementó una suite e2e de navegador. Las comprobaciones se concentraron en los contratos de datos, la persistencia, la privacidad y los puntos de integración con hardware.
