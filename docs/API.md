# API de Bosque Escucha

Todas las rutas son relativas a la URL desplegada. `Content-Type: application/json` salvo archivos multipart. Las credenciales viajan en `Authorization: Bearer ...`; nunca en query strings. La sesión operador es cookie HttpOnly, duración 12 horas.

## Bill: nodo y receptor

Para el MVP principal el receptor USB entrega paquetes al centro Python (ver `local-center/`). Si se usa el modo diagnóstico HTTP:

1. Configurar nodo con operador: `POST /api/nodes` con `{ "id":"BOSQUE-01", "name":"Nodo 01", "sector":"Sector A", "latitude":null, "longitude":null }`. Registrar coordenadas reales cuando estén disponibles.
2. Heartbeat cada 30 segundos: `POST /api/nodes/BOSQUE-01/heartbeat`, bearer `DEVICE_INGEST_TOKEN`, body `{ "status":"online", "battery_pct":null }`. Batería solo si se mide. El dashboard muestra offline tras 120 segundos sin contacto.
3. Subir evidencia: `POST /api/evidence`, multipart campos `file` y `node_id`. JPEG/PNG/WAV, máximo 4 MB, firma binaria validada. Devuelve `{path,type}`. El bucket es privado. La ruta usa SHA256 del contenido: repetir el mismo archivo/nodo devuelve la misma ruta (HTTP 200 si ya existe).
4. Evento: `POST /api/events`, mismo bearer. Ejemplo:

```json
{
  "event_id": "46042482-ef2e-4f03-912f-b9749df51879",
  "node_id": "BOSQUE-01",
  "event_type": "chainsaw",
  "confidence": 0.83,
  "persistent": true,
  "detected_at": "2026-10-17T18:00:00.000Z",
  "evidence_path": null,
  "evidence_type": null,
  "metadata": {"model":"yamnet","windows":3}
}
```

Tipos: `chainsaw|person|footsteps|ambient`. El UUID debe persistirse y reutilizarse en reintentos. Duplicados devuelven el evento previo sin duplicar incidentes. Fechas futuras más de 60 segundos se rechazan; eventos anteriores se aceptan para sincronización offline. `confidence` es score 0..1, no probabilidad calibrada. Ausencia de señales no demuestra ausencia de actividad.

La API no realiza inferencia: recibe resultados del centro local. Ambient se almacena sin incidente. Motosierra persistente → media; motosierra persistente + persona mismo nodo ±120 segundos → alta; otras señales → observación. Evidencia debe pertenecer al mismo nodo. Toda revisión humana queda auditada.

## Operación

- `GET /api/health`: salud de conexión, sin secretos.
- `GET /api/dashboard`: sin sesión solo DEMO-01, sin evidencias privadas ni detalles personales. Operador ve datos reales.
- `POST /api/session` `{password}`; `GET` estado; `DELETE` cerrar sesión.
- `PATCH /api/incidents/:id` `{status,review_note?,assigned_to?}`. Pendiente → descartado/verificado; verificado → asignado/cerrado; asignado → cerrado.
- Cambiar prioridad: misma ruta con `{priority,review_note}` (motivo mínimo 3 caracteres), separado del cambio de estado. Cambios manuales se conservan ante nuevas señales.
- `GET /api/evidence?path=...`: operador recibe redirección 307 a URL firmada de 60 segundos, compatible con imagen/audio.
- `POST /api/events` también admite `source:demo` exclusivamente con sesión operador y nodo DEMO-01, para reintentos con UUID estable. Tokens de dispositivo no autorizan demo.
- `POST /api/demo` `{scenario:"chainsaw"|"combined"|"ambient"}`: sesión operador; fuente demo explícita.

## Contactos y notificaciones

`GET /api/contacts` lista contactos. `POST /api/contacts` crea/actualiza `{id?,name,sector,destination,channel,enabled}`. `destination` E.164 (`+519...`), channel `whatsapp|sms`. El sector coincide exactamente con el nodo; se elige el primer contacto habilitado del sector.

`POST /api/incidents/:id/notify` con `{approved:true}` requiere incidente verificado/asignado y operador. Guarda aprobación, deduplica incidente/canal. Sin contacto: `blocked`. Demo: cola visible, sin envío externo. Sin webhook: `queued` y explicación.

`POST /api/notifications/dispatch` con sesión operador procesa hasta 10 registros pendientes. Reintentos persistidos: máximo 5 intentos, intervalo mínimo 5 minutos. El operador puede reintentar desde la interfaz; no hay cron programado automáticamente.

### Contrato n8n

Configurar `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET`, `NOTIFICATION_CALLBACK_SECRET` en servidor. El webhook recibe bearer N8N_WEBHOOK_SECRET y `{notification,incident,contact}`. `Idempotency-Key` contiene notification.id. **El flujo debe deduplicar por esa clave antes de enviar**: una respuesta perdida puede causar reintento con la misma clave. Solo usar el destinatario configurado y aprobado.

HTTP 2xx del webhook significa aceptado, no enviado ni entregado. Para confirmar estado, n8n/proveedor llama `POST /api/notifications/callback`, bearer NOTIFICATION_CALLBACK_SECRET:

```json
{"notification_id":"UUID","status":"delivered","provider_id":"ID real del proveedor"}
```

Estados callback: `sent`, `delivered`, `failed`. Usar exclusivamente evidencia real del proveedor. Confirmación humana independiente: `{notification_id,status:"acknowledged",actor:"Contacto que confirmó"}` después de respuesta real. `delivered_at` y `acknowledged_at` son independientes; ninguno cierra el incidente automáticamente.

## Sincronización centro local

`POST /api/sync` bearer CENTER_SYNC_TOKEN: `{nodes,events,incidents,audit,notifications}`. Arrays acotados; fechas ISO y UUID. Operación atómica. Eventos se normalizan a `source:local_center`; fuente demo y nodo DEMO-01 se rechazan. Decisiones humanas cloud prevalecen sobre snapshots posteriores. La sincronización no envía notificaciones.

Para evidencias, CENTER_SYNC_TOKEN también autoriza `POST /api/evidence`; reemplazar ruta local por el path devuelto antes del snapshot. No subir rutas locales del sistema de archivos. Los reintentos de sincronización conservan los mismos IDs.

### Límites y reconciliación

JSON normal: máximo 64 KB; snapshots: 2 MB; metadata y detalles de auditoría: 16 KB cada objeto. Se aplican también sin Content-Length. JSON inválido devuelve 400, cuerpo excesivo 413. `next_attempt_at` sí admite fecha futura porque representa un reintento planificado.

Antes de subir evidencias de un nodo nuevo, enviar snapshot solo de nodos y demás arrays vacíos. Luego subir archivos y enviar el snapshot completo.

La nube acepta revisiones locales sucesivas por updated_at mientras no haya revisión humana propia en nube. Cuando existe human_review del operador cloud, su decisión prevalece y requiere reconciliación operativa manual. Prioridades ajustadas en nube se conservan. Entrega y confirmación local pueden avanzar el registro cloud; snapshots antiguos nunca degradan sent/delivered ni borran confirmaciones.

### Propietario del envío

Los registros con `channel:whatsapp`/`sms` pertenecen al worker local; la nube solo despacha `channel:n8n`. Aprobar desde cloud devuelve la notificación existente del incidente, cualquiera sea el canal. Si hay una notificación local del incidente, cloud no despacha otra. No habilitar dos workers para el mismo ID. La respuesta de `/api/sync` incluye `notifications` con estados actuales cloud para que el centro local pueda reconciliar entrega y confirmación en el futuro.

## Adaptador Zavu (pendiente de activación)

- `POST /api/notifications/zavu/send`: credencial interna `N8N_ZAVU_ADAPTER_SECRET`, header `Idempotency-Key` igual a `notification_id` UUID del JSON. Reserva y consulta autorización en DB antes de invocar proveedor; no acepta destino del cliente. Respuesta queued no significa enviado.
- `POST /api/notifications/zavu/callback`: firma `X-Zavu-Signature` v2 sobre cuerpo crudo con `ZAVU_WEBHOOK_SECRET`, tolerancia cinco minutos. Vincula `data.messageId` previamente persistido; eventos sent/delivered/failed deduplicados atómicamente.
- Activación, migración pendiente y límites: [ZAVU.md](../integrations/n8n/ZAVU.md).
