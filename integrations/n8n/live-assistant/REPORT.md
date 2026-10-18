# Asistente n8n: publicado y webhook autenticado validado

Verificado el 2026-10-18. Workflow [pTeB2WRm0xk7bdKZ](https://jhomar-dev.app.n8n.cloud/workflow/pTeB2WRm0xk7bdKZ).

## Resultado comprobado

- El bloqueo de aprobación MCP de la sesión anterior ya no se reproduce: las actualizaciones se guardaron correctamente.
- El borrador remoto contiene webhook autenticado → validación de entrada → GPT-4o-mini Gateway → validación de respuesta → respuesta JSON.
- Se eligió `gpt-4o-mini` desde el catálogo real de Gateway en el editor. El panel mostró saldo $2.00; no hubo compra ni recarga.
- La ejecución manual **3** terminó `success` a las 05:25:53 UTC: llamada real al modelo `gpt-4o-mini-2024-07-18`, con 399 tokens de entrada y 130 de salida. Solo la entrada webhook fue fijada como muestra sintética; la salida LLM no fue simulada.
- La respuesta reconoce datos ficticios, expresa score 0.83, recomienda revisión humana y devuelve `sources: []`. Evidencia mínima: `synthetic-live-result.json`.
- Las ejecuciones 1 y 2 detectaron una incompatibilidad real: con JSON schema el nodo n8n entrega `content.text` como objeto. Se corrigió el validador para aceptar ese objeto o una cadena JSON y se añadieron pruebas de ambas formas.
- El coste monetario de las llamadas no figura en la respuesta MCP; no se inventa un coste. La ejecución 2 consumió 364 tokens de entrada y 138 de salida. La ejecución 1 no conservó datos por la política inicial de retención.

## Publicación y autenticación comprobadas

El usuario autorizó las tres credenciales Header Auth. Se asociaron mediante sus IDs existentes, se habilitó el webhook y se publicó el workflow. Relectura: `active=true`, versión activa `e28cae1c-1df9-4b03-9d5a-1a3c68935909`, idéntica al borrador.

Endpoint: `https://jhomar-dev.app.n8n.cloud/webhook/bosque-incidente-asistente`.

Pruebas HTTP de producción con la muestra ficticia:
- Sin Authorization: HTTP 403.
- Bearer incorrecto: HTTP 403.
- Bearer correcto: HTTP 200 con respuesta real de `gpt-4o-mini-2024-07-18`, fuentes vacías y revisión humana.

`http-verification.json` conserva respuestas sin encabezados ni secretos. La integración `/api/assistant` en Vercel también devolvió HTTP200 con sesión de operador y el incidente sintético DEMO-01. En el deploy `dpl_C4djMseSkreaxag4xDvryoQLUsj1` se comprobó la etiqueta determinista `DATOS DE PRUEBA`, limitación sintética y fuentes vacías. Evidencia `production-verification.json`.

## Archivos y validación

- `remote-observed.json`: estado remoto releído después de la prueba, sin valores secretos.
- `workflow.prepared.json` y `.sdk.ts`: configuración reproducible sin credenciales, con webhook deshabilitado.
- `synthetic-request.json`: entrada ficticia usada realmente en las pruebas manuales.
- `verify.mjs`: validación del contrato, límites, rechazo de entradas/salidas inválidas y compatibilidad de JSON estructurado.
- Validación MCP de nodos y SDK: correcta, cinco nodos. Verificación local: correcta.

El límite de salida es 650 tokens y el workflow tiene timeout de 25 segundos. No usa herramientas de búsqueda, audio o imágenes y no envía notificaciones. Retención de ejecuciones de producción y manuales restaurada a `none`/false; las ejecuciones 2 y 3 se conservaron temporalmente para diagnosticar exclusivamente la muestra sintética.

## Artefacto reproducible y producción

La plantilla `workflow.prepared.*` conserva su webhook deshabilitado para que una importación nueva exija asociar sus propias credenciales antes de publicar. El export `remote-observed.json` refleja el workflow realmente publicado y solo contiene referencias de credenciales, nunca sus valores.

El flujo de notificaciones `I91iM6yA5v9jt2zX` también fue publicado con las dos credenciales Header Auth: inbound y adaptador. Versión `30636d1b-1cf1-4fbb-8247-166709a4224e`; sin bearer o con bearer incorrecto devuelve HTTP403. Publicar el workflow no implica que Zavu tenga un sender disponible ni demuestra entrega de una alerta.

Prueba posterior al deploy Vercel `dpl_3Zkpmjb6vajLPEnP8r1RG3yZB59q`: adaptador Zavu con bearer correcto y UUID ficticio inexistente devuelve HTTP503 `Falta configurar Zavu y remitente WhatsApp`; webhook de notificaciones con bearer correcto devuelve HTTP500 genérico al propagar ese error. No se envió mensaje ni se reservó notificación. Evidencia: `../notificaciones-http-verification.json`. La configuración de sender sigue pendiente y el sistema bloquea el envío.

Corrección posterior de procedencia: la lista permitida inicial eliminaba `events.source` y `events.evidence_type`. Ahora conserva ambos como cadenas opcionales de hasta 100 caracteres y calcula `synthetic` por node_id DEMO/CHECK-LOCAL/SYNTHETIC o eventos demo/synthetic. El prompt exige marcar estos casos al inicio del resumen y en limitaciones. La aplicación añade además etiquetado determinista, pues un prompt no garantiza la clasificación. Publicado nuevamente como versión `4c34b00b-0b12-4ddd-a802-4e71b3319bba`; export actualizado, validación SDK y prueba local de procedencia correctas. No se realizó otra inferencia pagada para este cambio.
