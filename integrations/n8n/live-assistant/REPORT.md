# Asistente n8n: inferencia real validada; publicación pendiente de Header Auth

Verificado el 2026-10-18. Workflow [pTeB2WRm0xk7bdKZ](https://jhomar-dev.app.n8n.cloud/workflow/pTeB2WRm0xk7bdKZ).

## Resultado comprobado

- El bloqueo de aprobación MCP de la sesión anterior ya no se reproduce: las actualizaciones se guardaron correctamente.
- El borrador remoto contiene webhook autenticado → validación de entrada → GPT-4o-mini Gateway → validación de respuesta → respuesta JSON.
- Se eligió `gpt-4o-mini` desde el catálogo real de Gateway en el editor. El panel mostró saldo $2.00; no hubo compra ni recarga.
- La ejecución manual **3** terminó `success` a las 05:25:53 UTC: llamada real al modelo `gpt-4o-mini-2024-07-18`, con 399 tokens de entrada y 130 de salida. Solo la entrada webhook fue fijada como muestra sintética; la salida LLM no fue simulada.
- La respuesta reconoce datos ficticios, expresa score 0.83, recomienda revisión humana y devuelve `sources: []`. Evidencia mínima: `synthetic-live-result.json`.
- Las ejecuciones 1 y 2 detectaron una incompatibilidad real: con JSON schema el nodo n8n entrega `content.text` como objeto. Se corrigió el validador para aceptar ese objeto o una cadena JSON y se añadieron pruebas de ambas formas.
- El coste monetario de las llamadas no figura en la respuesta MCP; no se inventa un coste. La ejecución 2 consumió 364 tokens de entrada y 138 de salida. La ejecución 1 no conservó datos por la política inicial de retención.

## Estado pendiente

El workflow sigue **sin publicar** (`active=false`, sin versión activa). El webhook está deshabilitado y exige `headerAuth`; falta crear y asociar la credencial. No se ha probado tráfico HTTP autenticado ni la integración web de producción. La inferencia manual no demuestra que el endpoint público esté activo.

La política de la herramienta de navegador requiere confirmación al crear credenciales persistentes. La solicitud al usuario está pendiente; no se guardaron credenciales ni se retiró la autenticación para continuar.

URL prevista: `https://jhomar-dev.app.n8n.cloud/webhook/bosque-incidente-asistente`.
Crear Header Auth con `Name=Authorization`, `Value=Bearer <secreto compartido>`. Guardar en servidor `N8N_ASSISTANT_WEBHOOK_URL` y `N8N_ASSISTANT_WEBHOOK_SECRET` (sin prefijo Bearer). El secreto nunca va en estos archivos.

## Archivos y validación

- `remote-observed.json`: estado remoto releído después de la prueba, sin valores secretos.
- `workflow.prepared.json` y `.sdk.ts`: configuración reproducible sin credenciales, con webhook deshabilitado.
- `synthetic-request.json`: entrada ficticia usada realmente en las pruebas manuales.
- `verify.mjs`: validación del contrato, límites, rechazo de entradas/salidas inválidas y compatibilidad de JSON estructurado.
- Validación MCP de nodos y SDK: correcta, cinco nodos. Verificación local: correcta.

El límite de salida es 650 tokens y el workflow tiene timeout de 25 segundos. No usa herramientas de búsqueda, audio o imágenes y no envía notificaciones. Retención de ejecuciones de producción y manuales restaurada a `none`/false; las ejecuciones 2 y 3 se conservaron temporalmente para diagnosticar exclusivamente la muestra sintética.

## Finalización tras credencial

1. Asociar la credencial Header Auth y habilitar el webhook.
2. Publicar, verificar versión activa y rechazos sin bearer/con bearer incorrecto.
3. Configurar las dos variables Vercel y realizar una prueba desde `/api/assistant` con una entrada autorizada.

No repetir la selección de modelo ni sustituir el resumen manual por una afirmación de integración productiva.
