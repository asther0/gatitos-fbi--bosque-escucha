# Notificaciones WhatsApp con Zavu

Implementación preparada; **no activada ni probada con Zavu real**. No se enviaron mensajes. El export nuevo es `notificaciones-zavu.json`; el borrador manual anterior sigue conservado.

## Activación

1. Aplicar `supabase/migrations/202610180006_zavu_delivery.sql` y desplegar servidor. Aplicada al proyecto Supabase el 18 de octubre de 2026 (HTTP 201); pendiente ensayo de entrega real.
2. Obtener API key y remitente WhatsApp conectado en Zavu. Configurar en Vercel `ZAVUDEV_API_KEY`, `ZAVU_SENDER_ID`, `ZAVU_WEBHOOK_SECRET` y un nuevo secreto aleatorio `N8N_ZAVU_ADAPTER_SECRET`. No exponerlos en navegador ni export.
3. Importar export en n8n. En **Solicitud aprobada**, asignar credencial Header Auth con nombre `Authorization`, valor `Bearer <N8N_WEBHOOK_SECRET>`. En **Despachar con reserva persistente**, usar otra credencial Header Auth con `Authorization: Bearer <N8N_ZAVU_ADAPTER_SECRET>`.
4. Publicar workflow y configurar `N8N_WEBHOOK_URL` en servidor con su URL production `/webhook/bosque-notificaciones`. `N8N_WEBHOOK_SECRET` debe coincidir con paso 3.
5. Configurar webhook Zavu hacia `https://bosque-escucha.vercel.app/api/notifications/zavu/callback`, firma **v2**, eventos message.sent/delivered/failed. Conservar secret en servidor. v1 solo se rechaza; para remitente antiguo migrar v1 → v1+v2 antes de v2.
6. Registrar contacto WhatsApp autorizado para el sector, verificar incidente real y aprobar envío desde aplicación. Para mensaje libre el destinatario debe abrir la ventana WhatsApp de 24 horas escribiendo al remitente. Fuera de ella hace falta plantilla aprobada; esta versión no la configura automáticamente.

## Flujo y límites

Web → n8n autenticado → adaptador → reserva SQL única por notification_id → Zavu → recibo firmado → estado de entrega.

El adaptador obtiene aprobación, incidente y contacto de Supabase. Rechaza DEMO/CHECK, eventos demo, incidentes sin revisar y notificaciones pertenecientes a worker local. No confía en texto/destino enviados por n8n. La clave idempotente también se envía a Zavu. El proveedor recibe texto corto de alerta, sin archivos ni URLs. No hay fallback a SMS.

Una respuesta 202 crea estado **queued**, nunca sent/delivered. Callback firmado v2 HMAC-SHA256 sobre `{timestamp}.{rawBody}`, comparación constante y tolerancia cinco minutos; recibos deduplicados en transacción SQL. Desconocer provider_id devuelve 503 para reintento (posible carrera contra respuesta del envío). `read` no significa confirmación humana. No se cierra el incidente.

La reserva es permanente. Timeout, 409 o resultado ambiguo queda `uncertain`; una repetición no vuelve a enviar. Reconciliar en panel/API de Zavu y vincular provider_id en `be_zavu_dispatches` antes de procesar recibos. No borrar reserva para reintentar sin comprobar proveedor. Si se rechaza por ventana cerrada, corregir configuración y hacer revisión manual; no hay reenvío automático. Callback válido pero fuera de cinco minutos necesita reconciliación si el proveedor reutiliza timestamps antiguos.

**Pendientes reales:** cuenta/key/remitente Zavu, secret webhook, credenciales n8n, aplicar migración, activar export, destinatario autorizado, prueba recepción/callback/concurrencia con entorno real. La reserva SQL está revisada estáticamente pero aún no ejecutada contra Postgres.

## Verificación local

`npx tsx --test tests/zavu.test.ts` (firma válida, alteración, expiración, v1, secreto ausente) y `npx tsc --noEmit` pasaron. Ningún mensaje ni gasto de proveedor.

Contrato consultado: [API oficial de mensajes y firma](https://www.zavu.dev/en/messaging-api), [API de comunicación](https://www.zavu.dev/en/communication-api). POST `https://api.zavu.dev/v1/messages`, Bearer, `Zavu-Sender`, `idempotencyKey` en cuerpo; repetición devuelve 409. Consulta: 18 octubre 2026.
