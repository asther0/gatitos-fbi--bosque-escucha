# Herramientas disponibles

Fuente: [onboarding oficial Hack the Andes](https://hacktheandes.com/deck/onboarding), revisado el 17 de octubre de 2026.

| Herramienta | Beneficio anunciado | Uso propuesto |
| --- | --- | --- |
| n8n | Un mes Cloud Pro por participante | Cola de notificaciones, integración y callbacks del proveedor |
| Zavu | Tres meses | Beneficio disponible, pero descartado para las alertas del proyecto |
| Tavily | 8.000 créditos por participante | Contexto documental opcional, fuera del triage |
| Exa | USD 50 Search API | Búsqueda opcional de contexto |
| Apify | USD 100 | Fuentes públicas autorizadas si hay necesidad concreta |
| Maritime | USD 100 | Posible alojamiento futuro de un worker persistente |
| Lovable | Un mes Pro y 100 créditos, según voucher compartido por el equipo | No necesario para esta implementación |
| Qatom | Seis meses Max | Herramienta adicional del equipo |
| AtomicMemory | Cinco meses Pro | Memoria futura de agentes; no necesaria para el MVP |

El equipo compartió instrucciones y códigos de canje adicionales. Los beneficios siguen pendientes de verificar dentro de cada cuenta; los códigos no se publican en este repositorio. No se ha confirmado saldo para un proveedor de LLM.

## Decisión de IA

El PRD exige inferencia en laptop: [YAMNet](https://www.tensorflow.org/hub/tutorials/yamnet) para sonidos y [YOLO](https://docs.ultralytics.com/datasets/detect/coco/) clase persona. Los adaptadores reales están en `local-center/models.py`; requieren instalar dependencias y descargar pesos antes de trabajar offline. Los scores son salidas del modelo, no probabilidades calibradas de tala.

Un LLM puede resumir campos conocidos en una iteración posterior; nunca decide los envíos ni reemplaza las reglas de triage. [Gemini admite audio](https://ai.google.dev/gemini-api/docs/audio), pero enviar evidencias a un proveedor externo requiere decidir ese uso y configurar sus credenciales. El circuito actual funciona sin clave de LLM.

## Integración n8n con Kapso

El centro persiste primero la aprobación humana. Después llama al webhook con `Idempotency-Key` y Bearer secret. n8n debe deduplicar persistentemente por notification.id **antes** de llamar a WhatsApp, conservar el ID del proveedor y reportar estados a `/api/notifications/callback`. Una respuesta HTTP del webhook no acredita entrega ni atención humana.

El flujo n8n y el número Arvid Company ya están conectados por separado. La clave API de Kapso y el webhook firmado están configurados. Falta corregir la credencial de despacho en n8n, acordar un destinatario y probar una entrega real. No se han enviado alertas externas desde este flujo. Consultar `docs/API.md` para el contrato exacto.

## Selección para la siguiente integración

1. **n8n + Kapso:** cerrar aprobación → notificación → entrega y respuesta. Hace falta corregir la credencial de n8n y un destinatario de prueba.
2. **Tavily:** consulta opcional de documentos oficiales por región y tema, con enlaces y fecha. Puede ayudar a preparar contexto para el operador; no acredita lo ocurrido en el bosque. Tiene [integración documentada con n8n](https://docs.tavily.com/documentation/integrations/n8n).
3. **Exa:** alternativa para búsqueda y recuperación de documentos, con [integración n8n](https://exa.ai/integrations/n8n). Por ahora no se propone conectar ambos buscadores.

n8n soporta [agentes que delegan a otros agentes](https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.toolaiagent/). Para el MVP se propone un asistente que resuma el incidente registrado y consulte contexto cuando se lo solicite el operador. Los modelos acústicos/visuales y las reglas existentes siguen separados de ese resumen.

n8n Cloud admite claves propias de proveedor o [Gateway credits opcionales](https://support.n8n.io/article/can-i-use-my-own-ai-api-key-on-n-8-n-cloud). El voucher Pro no confirma saldo Gateway ni créditos de inferencia. Hay que comprobarlo en la cuenta antes de elegir modelo.

Para búsquedas contextuales basta región y tema; no se propone enviar coordenadas precisas, audios ni imágenes al buscador. Lovable, Apify, AtomicMemory, Qatom y Maritime quedan como opciones: actualmente no desbloquean el circuito principal.
