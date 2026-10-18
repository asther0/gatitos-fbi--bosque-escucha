# Contrato de integración MVP

Next.js App Router en raíz, TypeScript, CSS propio, Leaflet. API y tipos compartidos en `lib/types.ts`. Base Supabase; nombres de tablas con prefijo `be_`. Centro Python autónomo en `local-center/` con SQLite y carpeta de evidencias; comparte estados y payloads con web. Nunca credenciales en Git.

## Modelo compartido (snake_case)

- Node: id (text, ej. BOSQUE-01), name, sector, latitude, longitude, status (online/offline/maintenance), battery_pct (number|null), last_seen (ISO|null), created_at.
- Event: id (uuid), node_id, event_type (chainsaw/person/footsteps/ambient), confidence (0..1), detected_at, received_at, source (device/manual/demo/local_center), persistent (boolean), evidence_path (string|null), evidence_type (image/audio|null), metadata (JSON).
- Incident: id (uuid), node_id, title, priority (high/medium/observation), status (pending_review/discarded/verified/assigned/closed), summary, event_ids (uuid[]), assigned_to (string|null), review_note (string|null), created_at, updated_at.
- Audit: id, incident_id, action, actor, details (JSON), created_at.
- Notification: id, incident_id, channel, status (queued/sent/failed), approved_by, created_at, sent_at, last_error.

## API

- GET `/api/dashboard`: `{ nodes, events, incidents, notifications, audit, configured: boolean, error?: string }`. UI usa polling 10s, no secretos. Respuestas sin caché. Solo datos de demostración en acceso público; datos reales requieren sesión operador.
- POST `/api/session` `{password}`: cookie HttpOnly operador validada con OPERATOR_PASSWORD. DELETE cierra sesión. GET devuelve `{authenticated}`.
- POST `/api/events`: Bearer DEVICE_INGEST_TOKEN o sesión operador. JSON `{node_id,event_type,confidence,persistent?,detected_at?,source?,metadata?,evidence_path?,evidence_type?}`. Responde `{event,incident}`. Dedupe opcional `event_id` UUID del dispositivo. Idempotente.
- POST `/api/evidence`: multipart `file`, `node_id`; Bearer dispositivo o sesión. Responde `{path,type}`. Limitar 4 MB por Vercel; JPEG/PNG/WAV. Storage privado.
- GET `/api/evidence?path=...`: sesión operador, URL firmada o redirect.
- PATCH `/api/incidents/[id]`: sesión operador; `{status,review_note?,assigned_to?}`. Transiciones validadas: pending_review→discarded/verified; verified→assigned/closed; assigned→closed. Registro auditoría.
- POST `/api/incidents/[id]/notify`: sesión operador y estado verified/assigned; `{approved:true}`. Cola persistente deduplicada. Nunca envío automático sin aprobación. Sin proveedor: queued y explicación.
- POST `/api/demo`: sesión operador; `{scenario:chainsaw|combined|ambient}` crea eventos explícitamente demo en nodo DEMO-01 y su incidente. Nunca identificar demo como detección real.
- POST `/api/sync`: Bearer CENTER_SYNC_TOKEN; snapshot `{nodes,events,incidents,audit,notifications}` del centro local, upsert por id. Source local_center. No notificar por sincronización.

## Triage

Alta: motosierra persistente + persona mismo nodo dentro de 120 s. Media: motosierra persistente sola. Observación: pasos/persona/motosierra aislada. Ambient no genera incidente. Ventana correlación 120 s. Sin inferir ilegalidad, identidad ni probabilidad calibrada. Evitar reclasificar decisiones humanas. IA enriquecedora opcional nunca autoriza envíos.

## Propiedad de archivos

- root: scaffold/package/config, `lib/types.ts`, auth `lib/auth.ts` + `app/api/session`, scripts despliegue, documentación integración, revisión/merge.
- frontend: `app/page.tsx`, `app/layout.tsx`, `app/globals.css`, `components/`, `public/`.
- backend: `lib/supabase.ts`, `lib/triage.ts`, `lib/data.ts`, resto `app/api/` salvo session; `supabase/`.
- local: `local-center/`; conversión PRD.

## Extensión operativa implementada

Ver `docs/API.md` para payloads de Bill y n8n. Nodos aceptan coordenadas null; POST `/api/nodes` registra/actualiza ubicación y sector, POST `/api/nodes/:id/heartbeat` salud de enlace. Offline tras 120 s sin contacto. GET/POST `/api/contacts` administra destinatarios por sector con sesión operador. PATCH incidente admite prioridad + motivo y conserva decisiones humanas.

Notificaciones: estados queued/sent/delivered/failed/blocked; delivered_at separado de acknowledged_at/acknowledged_by; intentos persistidos y lease de 5 minutos, máximo 5. POST `/api/notifications/dispatch` reintento manual; callback autenticado por NOTIFICATION_CALLBACK_SECRET. Ningún HTTP 2xx del webhook se considera entrega. Sin destinatario configurado se bloquea. Demo guarda aprobación sin emitir envío. Idempotencia de envío requiere dedupe n8n por Idempotency-Key.

GET `/api/health` verifica conectividad sin secretos. Evidencia privada acepta CENTER_SYNC_TOKEN para subida previa a snapshot. Sync rechaza source demo y valida rutas por nodo. Timestamp futuro >60 s se rechaza. Público solo demo y sin notas, destinatarios o auditoría personal.
