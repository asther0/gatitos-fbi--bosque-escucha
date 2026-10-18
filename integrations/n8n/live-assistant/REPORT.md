# Asistente live: bloqueado, no publicado

Revisión 2026-10-18 mediante n8n-bosque MCP. Workflow existente: pTeB2WRm0xk7bdKZ.
Editor: https://jhomar-dev.app.n8n.cloud/workflow/pTeB2WRm0xk7bdKZ

## Estado real
- Workflow remoto sin cambios: active=false, activeVersionId=null; sigue siendo el borrador determinista original.
- update_workflow fue rechazado: `MCP tool call requires approval, but approval policy is never`. Relectura confirmó que no se añadió el nodo Gateway.
- No se publicó, no se ejecutó LLM ni prueba remota, no se compraron créditos, no se recargó saldo, no se enviaron notificaciones.
- Gateway available=true; el panel de n8n muestra $2.00. La herramienta MCP no devuelve balance ni configuración de recarga.
- list_credentials devolvió cero credenciales. No se extrajeron valores secretos.
- No existe operación create_credentials/create_credential en el conjunto de herramientas MCP expuesto. setNodeCredential solo vincula una credencial existente.
- explore_node_resources requiere credentialId accesible. No hay uno disponible.
- discover_agent_assets devolvió catálogo OpenAI con verified=false: no equivale a modelos habilitados por Gateway. No se seleccionó ni inventó modelo.

## Archivos
- remote-observed.json: export sin secretos del estado remoto realmente observado.
- workflow.prepared.json y workflow.prepared.sdk.ts: propuesta local, NO export de una implementación remota. Webhook y LLM deshabilitados, modelo vacío y credenciales sin asignar. No apta para publicar todavía.
- synthetic-request.json: payload sintético para una única prueba futura, nunca enviado.
- verify.mjs: comprobaciones locales de contrato, límites y rechazo de salida inválida.
La validación estructural MCP de los cinco nodos y del grafo pasó; no prueba credenciales, inferencia real ni autenticación.

## URL y credenciales pendientes
URL propuesta, no activa ni comprobada:
https://jhomar-dev.app.n8n.cloud/webhook/bosque-incidente-asistente

Crear en n8n una credencial de tipo httpHeaderAuth: Name=Authorization, Value=Bearer <secreto aleatorio>. Nunca guardar el secreto en export, código ni reporte. Asociarla al Webhook.
La aplicación necesita N8N_ASSISTANT_WEBHOOK_URL con la URL publicada y N8N_ASSISTANT_WEBHOOK_SECRET con el mismo secreto SIN el prefijo Bearer. Configurar solo en servidor.
Para el LLM, añadir el nodo OpenAI text/response v2.3 con asignación Gateway administrada; descubrir modelSearch con la credencial administrada real. Seleccionar un modelo de texto económico de la lista confirmada, consultar coste y limitar salida. No usar API keys de otro proveedor ni recargar.
El presupuesto de $2 no tiene control acumulado local; verificar límite/prepago y ausencia de recarga automática en Gateway antes de publicar. No afirmar que maxTokens garantiza un límite total de gasto.

## Integración web y contrato
La ruta actual app/api/assistant/route.ts usa las variables anteriores y Authorization bearer, pero NO envía mode: "live". Añadirlo en una tarea con permiso para editar fuera de esta carpeta. Actualmente la propuesta rechazaría ese payload.
Entrada POST JSON: {incident:{id,title,summary,priority,status,node_id},events:[{event_type,confidence,persistent,detected_at}],mode:"live"}.
Se aceptan hasta 30 eventos y 24,000 caracteres JSON; solo se transmite al modelo la lista explícita de campos del contrato. Los encabezados y campos extra no se propagan.
Salida: {summary,recommended_action,limitations,sources:[],model?}. Modelo tomado de la respuesta real del proveedor. Sin herramientas de búsqueda. Nunca notifica.
Prompt exige hechos atribuidos a entrada, no inferir ilegalidad ni identidad, score no probabilidad de delito, metadatos sin audio/imágenes y decisión humana. El validador rechaza fuentes no vacías y añade límites fijos. El esquema no demuestra veracidad semántica: revisar la prueba real.
El error de validación de entrada detiene el workflow antes del LLM; todavía devuelve error n8n genérico, no un HTTP 400 personalizado.

## Cómo terminar
1. Resolver la política de aprobación de escritura MCP; no eludirla por UI o APIs alternativas.
2. Provisionar Header Auth por la UI y asignar su ID, sin revelar su valor.
3. Confirmar modelo Gateway y coste, completar configuración y habilitar nodos.
4. Ajustar mode en la ruta web y configurar sus variables de entorno de servidor.
5. Verificar autenticación rechazada sin bearer/incorrecto y ejecutar una sola prueba sintética con el contrato. Esta sesión no pudo hacerla.
6. Publicar solo con autenticación efectiva y LLM real, relectura de versión activa y revisión de respuesta.
No se hizo commit ni se editaron archivos fuera de esta carpeta.

