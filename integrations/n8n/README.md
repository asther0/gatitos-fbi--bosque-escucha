# Integraciones n8n de Bosque Escucha

El flujo de notificaciones publicado es [Bosque Escucha - Notificaciones Kapso](https://jhomar-dev.app.n8n.cloud/workflow/I91iM6yA5v9jt2zX). Recibe solicitudes aprobadas por un webhook autenticado y llama al adaptador `/api/notifications/kapso/send`. La configuración y los pasos que faltan para probar un WhatsApp real están en [KAPSO.md](KAPSO.md). El export importable es `notificaciones-kapso.json`; no hay que importarlo para editar el flujo existente.

El asistente de incidentes está en [Bosque Escucha - Asistente de incidente](https://jhomar-dev.app.n8n.cloud/workflow/pTeB2WRm0xk7bdKZ). Su implementación y verificación están en `live-assistant/REPORT.md`.

Los archivos `notificaciones.json` y `notificaciones.sdk.ts` son el borrador sintético inicial; no son el flujo publicado y no envían mensajes. `notificaciones-zavu.remote-observed.json` conserva una observación histórica anterior al cambio de proveedor.

El webhook n8n aceptando una solicitud no acredita entrega. Solo un recibo firmado del proveedor puede avanzar a `sent` o `delivered`; el reconocimiento `acknowledged` depende de una respuesta humana.
