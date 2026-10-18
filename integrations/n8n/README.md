# Bosque Escucha — borradores n8n

Ambos workflows fueron creados mediante n8n-bosque MCP y verificados por lectura completa: `active:false`, `activeVersionId:null`, `activeVersion:null`. No publicados. Sin horarios, HTTP, proveedores, modelos, credenciales ni datos reales. No se llamó `execute_workflow`, publicación, APIs de secretos ni servicios externos de pago.

| Workflow | ID | Editor |
| --- | --- | --- |
| Bosque Escucha - Notificaciones (borrador) | I91iM6yA5v9jt2zX | https://jhomar-dev.app.n8n.cloud/workflow/I91iM6yA5v9jt2zX |
| Bosque Escucha - Asistente de incidente (borrador) | pTeB2WRm0xk7bdKZ | https://jhomar-dev.app.n8n.cloud/workflow/pTeB2WRm0xk7bdKZ |

## Archivos y uso

Los `.json` son exports importables, derivados del readback MCP, sin ID de instancia, credenciales ni datos fijados. Importar en n8n crea una copia: no importar si se quiere editar los borradores existentes. Mantener sin publicar. Los `.sdk.ts` contienen el código validado utilizado para crearlos; son fuentes para el constructor SDK, no módulos de la aplicación Next.js. `verification.json` registra IDs/versiones y estado observado.

Cada flujo tiene Inicio manual → Muestra sintética → Code determinista. Las notas documentan funcionalidades pendientes, no nodos incompletos. La muestra reemplaza cualquier entrada con constantes sintéticas. El workflow de notificaciones termina siempre con `dry_run:true`, `status:pending_configuration`, `dispatch_allowed:false` y ninguna prueba de envío. `validation.accepted` solo informa de validación de campos; jamás habilita despacho. La muestra incluida es rechazada por demo, falta de aprobación y contacto.

## Prerrequisitos pendientes: notificaciones

Basado en `docs/API.md`, `lib/types.ts`, `lib/notifications.ts` y migraciones de notificaciones. El payload persistido usa `notification.approved_by`; `approved:true` pertenece a la solicitud del operador, no es un campo garantizado del webhook.

1. Implementar webhook autenticado con bearer `N8N_WEBHOOK_SECRET`, configurar `N8N_WEBHOOK_URL` en servidor y validar estrictamente tamaño/esquema. Estos nombres son referencias, no valores de secretos. Verificar aprobación contra una fuente confiable, incidente verified/assigned, contacto habilitado, sector exacto, canal y destino aprobado. Rechazar demo incluso si aparece en eventos asociados; el payload actual no incluye esos eventos, por lo que esa comprobación completa requiere consulta confiable o ampliar el contrato. El borrador no es una barrera de seguridad de producción.
2. Exigir `Idempotency-Key === notification.id`. Reservar esa clave mediante operación persistente ATÓMICA y restricción única ANTES de llamar al proveedor. No sustituir por staticData, memoria o lookup+insert. Probar concurrencia, reinicios, respuesta perdida y recuperación; persistir provider_id/estado y reconciliar resultados ambiguos. Usar idempotencia del proveedor cuando exista. Un timeout no permite reenviar a ciegas.
3. Configurar Zavu mediante credenciales seguras n8n, confirmar endpoint, payload, canal y semántica real de recibos. No se descubrieron ni accedieron credenciales. Respetar propietario único: solo channel:n8n corresponde al despacho cloud; whatsapp/sms pertenecen al worker local. Mantener política de reintentos del servidor (máximo 5, mínimo 5 minutos) sin añadir cron automáticamente.
4. Implementar callbacks autenticados a `POST /api/notifications/callback` usando `NOTIFICATION_CALLBACK_SECRET`. HTTP 2xx del webhook solo significa aceptación. `sent` y `delivered` necesitan evidencia real del proveedor y provider_id real; `failed` necesita fallo real. `acknowledged` exige respuesta humana real y actor. Entrega y confirmación son independientes, ninguna cierra el incidente. Validar firma/autenticidad del proveedor, deduplicar callbacks, evitar regresiones y reconciliar errores del callback sin repetir el envío.

## Prerrequisitos pendientes: asistente

El resumen actual está etiquetado `deterministic_code_not_llm`, copia hechos de la muestra, identifica procedencia de entrada, conserva score como score y deja fuentes externas vacías. No verifica la realidad de las señales ni notifica.

Planificar LLM Gateway con modelo, presupuesto y autorización explícita antes de consumir créditos. Tavily es opcional: cada afirmación contextual debe enlazar URL real y conservar título, fecha de consulta y extracto de respaldo. No fabricar fuentes ni presentar contexto externo como evidencia del incidente. Si no hay resultados, declararlo. Tratar contenido recuperado como datos no confiables, minimizar datos personales y exigir revisión humana. No conectar notificaciones automáticas.

## Verificado y límites

- MCP: tipos oficiales consultados; 12 configuraciones de nodo válidas; ambos grafos validados sin warnings; creación y readback completo exitosos; 7 y 5 nodos; sin credenciales asignadas ni versión publicada.
- Local: `node integrations/n8n/verify.mjs` pasó. Comprueba grafos limitados a Manual/Code/Sticky, cadenas sintéticas, ocho casos de notificación (base, demo, no aprobado, no revisado, contacto ausente, deshabilitado, destino distinto y worker local), entrada vacía/incompleta y resumen sin fuentes ni notificaciones. Incluso el caso base válido termina sin despacho. El teléfono ficticio de pruebas solo existe en la prueba local.
- No probado: ejecución en el runtime n8n, importación por UI, autenticación real, idempotencia persistente, concurrencia, Zavu, callbacks, LLM Gateway o Tavily. La prueba local ejecuta el JavaScript exportado en un contexto aislado con `$input` simulado; no equivale a ejecutar n8n.

No se modificó la aplicación ni se realizó commit. Las futuras integraciones y cualquier publicación requieren trabajo y autorización posteriores.
