# Herramientas disponibles

Fuente: [onboarding oficial Hack the Andes](https://hacktheandes.com/deck/onboarding), revisado el 17 de octubre de 2026.

| Herramienta | Beneficio anunciado | Uso propuesto |
| --- | --- | --- |
| n8n | Un mes Cloud Pro por participante | Cola de notificaciones, integración y callbacks del proveedor |
| Zavu | Tres meses | WhatsApp, con cuenta, destinatario y condiciones del proveedor configurados |
| Tavily | 8.000 créditos por participante | Contexto documental opcional, fuera del triage |
| Exa | USD 50 Search API | Búsqueda opcional de contexto |
| Apify | USD 100 | Fuentes públicas autorizadas si hay necesidad concreta |
| Maritime | USD 100 | Posible alojamiento futuro de un worker persistente |
| Lovable | Plan Pro; duración no indicada | No necesario para esta implementación |
| Qatom | Seis meses Max | Herramienta adicional del equipo |
| AtomicMemory | Cinco meses Pro | Memoria futura de agentes; no necesaria para el MVP |

El deck no indica mecanismos de canje ni límites adicionales. No se verificó ningún crédito de LLM ni una herramienta llamada «jev». Confirmar activación con la organización.

## Decisión de IA

El PRD exige inferencia en laptop: [YAMNet](https://www.tensorflow.org/hub/tutorials/yamnet) para sonidos y [YOLO](https://docs.ultralytics.com/datasets/detect/coco/) clase persona. Los adaptadores reales están en `local-center/models.py`; requieren instalar dependencias y descargar pesos antes de trabajar offline. Los scores son salidas del modelo, no probabilidades calibradas de tala.

Un LLM puede resumir campos conocidos en una iteración posterior; nunca decide los envíos ni reemplaza las reglas de triage. [Gemini admite audio](https://ai.google.dev/gemini-api/docs/audio), pero enviar evidencias a un proveedor externo requiere decidir ese uso y configurar sus credenciales. El circuito actual funciona sin clave de LLM.

## Integración n8n pendiente de credenciales

El centro persiste primero la aprobación humana. Después llama al webhook con `Idempotency-Key` y Bearer secret. n8n debe deduplicar persistentemente por notification.id **antes** de llamar a WhatsApp, conservar el ID del proveedor y reportar estados a `/api/notifications/callback`. Una respuesta HTTP del webhook no acredita entrega ni atención humana.

Falta configurar instancia n8n, cuenta Zavu/proveedor, destinatario acordado y secreto de callbacks. No se han enviado mensajes externos. Consultar `docs/API.md` para el contrato exacto.
