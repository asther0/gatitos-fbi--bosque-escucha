# Notificaciones WhatsApp con Zavu

Implementación de alertas preparada; **backend de alertas aún no activo** por falta de remitente WhatsApp propio. Prueba real de respuesta desde Inbox sandbox realizada el 18 de octubre de 2026: proveedor confirmó `read` y costo total 0. Esta prueba valida el canal sandbox, no el flujo web → n8n → adaptador. El workflow n8n `I91iM6yA5v9jt2zX` está publicado con sus dos credenciales Header Auth; el export observado está en `notificaciones-zavu.remote-observed.json`.

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

## Estado real comprobado — 18 octubre 2026

- Clave existente recuperada del panel, guardada únicamente en archivo privado ignorado `.local/zavu-api-key`. API autenticada devuelve HTTP 200.
- Conversación sandbox recibió «Hola Bosque Escucha». Respuesta de prueba enviada una sola vez mediante Inbox, claramente identificada como prueba técnica. Consulta API confirmó `read`, `costTotal: 0`, ID `jx7b0bcm9cdsa8zhbmhwtx99ad8ghz0k`.
- `GET /v1/senders` devuelve `items: []`. Ni conversación ni mensajes sandbox contienen `senderId`. No se usa el número telefónico como ID ni se inventa endpoint sandbox.
- El panel indica que sandbox es el número de Zavu para pruebas con teléfonos del equipo, no un número para clientes. Hace falta conectar un remitente WhatsApp propio para `ZAVU_SENDER_ID`, configurar su webhook v2 y ensayar entrega del adaptador.
- Código promocional `HACKTHEANDES26` aún no canjeado. No se compraron créditos ni se cambió el plan.

**Pendientes reales:** elegir y conectar el número remitente propio, secret webhook y prueba completa de aprobación/recepción/callback/concurrencia. Las credenciales n8n ya están creadas, los workflows publicados y las variables disponibles en Vercel. El adaptador devuelve 503 porque aún falta el remitente; no envía mensajes. Una entrega sandbox leída no demuestra esas piezas.

La migración `202610180007_zavu_delivery_transitions.sql` permite que un `failed` posterior a `sent` refleje el fallo de entrega. Un `sent` tardío no borra `failed`; `delivered` permanece terminal. Aplicada en Supabase (HTTP 201), con cinco transiciones comprobadas dentro de una transacción revertida. El timeout de la web es 25 segundos, mayor que los 20 segundos de n8n y los 15 del adaptador. Un error técnico del webhook registra `last_error` y conserva el estado pendiente: no se confunde con un fallo confirmado del proveedor.

## Verificación local

`npx tsx --test tests/zavu.test.ts` (firma válida, alteración, expiración, v1, secreto ausente) y `npx tsc --noEmit` pasaron. Estas comprobaciones no envían mensajes. La prueba sandbox real anterior tuvo costo reportado 0.

Contrato consultado: [API oficial de mensajes y firma](https://www.zavu.dev/en/messaging-api), [API de comunicación](https://www.zavu.dev/en/communication-api). POST `https://api.zavu.dev/v1/messages`, Bearer, `Zavu-Sender`, `idempotencyKey` en cuerpo; repetición devuelve 409. Consulta: 18 octubre 2026.

Prueba SQL reproducible: `tests/zavu-delivery-transitions.sql` (requiere migración 007; revierte todos los fixtures).

Conexión preparada en el panel Zavu: puede vincularse una cuenta WhatsApp Business existente mediante Meta o registrar un número propio. La opción Business abrió el inicio de sesión oficial de Meta; requiere la cuenta del usuario que administre ese número. El número destinatario de pruebas no se asume como emisor. No se compró un número ni se vinculó una cuenta sin identificarla.
