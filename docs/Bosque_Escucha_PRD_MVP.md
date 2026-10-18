# BOSQUE ESCUCHA / PRD v1.1

**Hack the Andes | Clima y Territorio | 17 octubre 2026**

> Transcripción del PDF original de 9 páginas. Se conservan su contenido, tablas y enlaces; el diagrama de arquitectura se representa como un flujo textual.

## 1. Vigilancia con evidencia

PRD v1.1 · Arquitectura actualizada por el equipo. Diseño propuesto; integración electrónica y desempeño pendientes de prueba.

### Problema y valor

La vigilancia de un territorio extenso puede descubrir actividad de corte demasiado tarde y sin evidencia suficiente para coordinar una inspección. El producto reduce la distancia entre escuchar un indicio, verificar el sector y asignar una respuesta.

Bosque Escucha: un nodo instalado en un árbol combina micrófonos y cámara. La IA busca sonidos compatibles con motosierra, indicios acústicos de pasos y personas visibles. Un centro de comando web en la laptop agrupa la evidencia, aplica triage y permite notificar por WhatsApp a contactos definidos.

Alcance cerrado: se elimina el reconocimiento de aves. La cámara identifica personas, no identidades. Una motosierra no demuestra tala ilegal; los pasos no confirman por sí solos presencia humana. La salida es una sospecha explicable para inspección.

| Quién | Valor |
| --- | --- |
| Vigilante o comunidad | Recibir sector, hora y evidencia útil para verificar. |
| Operador | Priorizar y asignar; evitar múltiples mensajes del mismo evento. |
| Contacto territorial | Recibir un reporte breve, reconocerlo y comunicar su atención. |

### El wow de la demo

Una persona entra en el encuadre y se reproduce una motosierra. El mapa destaca el sector, muestra audio e imagen, explica la prioridad y deja aprobar un mensaje de WhatsApp. Se corta Internet: la detección local sigue y el envío queda pendiente. Al reconectar, se entrega una sola notificación.

Impacto a medir: tiempo hasta detección, revisión y confirmación; falsos positivos; incidentes atendidos. No afirmar árboles salvados ni reducción de tala sin un piloto de campo.

Contexto: Geobosques reporta 150 602 ha de pérdida de bosque húmedo amazónico en 2024 [1]. Esta cifra no equivale a tala ilegal ni al impacto atribuible al prototipo.

## 2. Arquitectura acordada

Un nodo de árbol integrado y un ESP32 receptor conectado a la laptop. El Archer C50 es el intermediario de red local.

```text
ÁRBOL · nodo A01
  ESP32-CAM + cámara OV3660
  1 INMP441 inicial; 2 como ampliación
  Alimentación propia adecuada
        ↓
Archer C50
  Wi-Fi 2,4 GHz · DHCP
  Red local sin Internet
        ↓
ESP32 sin cámara · receptor
  Recibe paquetes por Wi-Fi
  Puente binario hacia USB serie
        ↓
Laptop · centro de comando
  USB → ingestión → IA audio y visión
  Web + mapa + triage + base y cola locales
        ↓
Operador
  Verifica, prioriza y asigna
        ↓
WhatsApp prioritario
  Internet + proveedor habilitado
  SMS como respaldo opcional
```

El router no emula la radio LoRa: representa el enlace lógico de transporte. Ubicarlo donde ambos ESP tengan cobertura y alimentación, preferentemente junto a la base. No necesita ir en el árbol.

La laptop recibe los datos por el ESP32 USB en el diseño principal. Recepción Wi-Fi directa por laptop queda como modo de diagnóstico si el puente limita el caudal; debe indicarse en la demo si se usa.

## 3. Conexión del nodo de árbol

Cambio respecto de v1.0: micrófono conectado al ESP32-CAM. El antiguo pinout D25/D26/D33 del ESP32 normal queda retirado para este nodo.

Condición: siguiente asignación candidata para ESP32-CAM con pinout AI-Thinker clásico y sin microSD. Verificar revisión, PSRAM y esquema de la placa fotografiada antes de energizar; el sensor OV3660 por sí solo no identifica toda la placa.

| INMP441 | ESP32-CAM · propuesta | Observación |
| --- | --- | --- |
| VDD | 3V3 | Nunca conectar micrófono a 5 V |
| GND | GND | Tierra común |
| L/R | GND | Primer micrófono: canal izquierdo |
| SCK | GPIO14 / IO14 | Reloj I²S1; microSD deshabilitada |
| WS | GPIO15 / IO15 | Selección de canal; pin de arranque |
| SD | GPIO13 / IO13 | Entrada de audio I²S1 |

Periféricos: cámara en I²S0 y micrófono en I²S1 en ESP32 clásico [2]. Reservar pines de cámara y PSRAM. GPIO15 participa en el arranque: verificar que el módulo no fuerce un nivel incompatible. No inicializar microSD; comparte estos pines.

Dos micrófonos: compartir SCK, WS y SD; ambos a 3V3 y tierra, L/R del primero a GND y del segundo a 3V3. Esto permite canales izquierdo/derecho según datasheet [3]. Empezar con uno. No conectar cuatro salidas SD al mismo bus; los otros dos quedan de repuesto. Dos micrófonos no aportan geolocalización automática.

Alimentación y programación: usar base USB compatible o entrada de alimentación documentada de la placa, con fuente estable. Si no existe USB integrado, confirmar programador USB-UART con lógica de 3,3 V. No alimentar la cámara desde el pin 3V3 del ESP32 receptor ni asumir tensión en VCC.

Montaje: desconectar alimentación; revisar etiquetas y soldaduras; usar jumpers cortos; dejar libre el puerto acústico. Probar audio y foto por separado antes de concurrencia. Si el driver falla al compartir recursos, programar ventanas alternadas de audio y foto y declarar sus intervalos ciegos.

## 4. Transporte actual y futuro LoRa

La integración crítica es cámara + audio en una placa y transporte de ambos a través del puente USB. Reducir caudal antes de añadir complejidad.

| Elemento | Contrato propuesto |
| --- | --- |
| Audio | PCM mono 16 bits / 16 kHz: 32 000 bytes/s. Recibir I²S de 24 bits en palabras de 32 y convertir correctamente. |
| Cámara | JPEG inicial 320×240 bajo demanda o espaciado. Prioridad de transmisión para audio. |
| Paquetes | Tipo audio/imagen/estado, node_id, secuencia, longitud, timestamp y checksum; fragmentar JPEG. |
| Receptor ESP32 | Reensamblar o reenviar fragmentos con buffers acotados; reportar pérdida y salud del enlace. |
| USB serie | Probar 921600 baudios. A 115200, 8N1 permite aproximadamente 11 520 bytes/s: insuficiente para este audio sin comprimir. |
| Backpressure | Confirmaciones, límite de cola, descarte explícito de frames viejos y reconexión. Logs separados de los datos binarios. |

Presupuesto: 921600 baudios ofrece como máximo teórico unos 92 160 bytes/s en 8N1, antes del protocolo. Dos canales de audio duplican caudal; empezar con mono y fotos ocasionales. Medir velocidad real y estabilidad de USB-UART, firmware y sistema operativo.

### Evolución a mayor distancia

Árbol: ESP32-CAM + transceptor LoRa + antena compatible. Base: segundo transceptor LoRa + antena + ESP32 USB o adaptador USB compatible → laptop. Una antena sola no añade LoRa. Verificar frecuencia autorizada, potencia, compatibilidad y pines disponibles antes de comprar.

LoRa llevaría eventos compactos: nodo, hora, clase, score, estado y batería si se mide. No transportar el flujo continuo de audio y fotos de este MVP. Para detectar sin ese flujo hará falta inferencia local en nodo o gateway cercano; las imágenes requerirán almacenamiento y otro enlace. La incorporación de LoRa exige rediseño de firmware, pines y presupuesto de energía.

## 5. IA multimodal y triage

Modelos ejecutados en laptop para el MVP. El nodo captura; el receptor transporta; la laptop analiza y presenta evidencia.

| Señal | Modelo / lógica | Uso |
| --- | --- | --- |
| Motosierra | YAMNet: evaluar clase Chainsaw y confusores [4]. Persistencia de varias ventanas. | Indicio principal de actividad de corte. |
| Pasos | Evaluar clase de pasos del modelo y muestras locales. No asumir fiabilidad a distancia. | Indicio secundario para pedir una foto; nunca alerta urgente por sí solo. |
| Persona | Detector YOLO pequeño, clase person de COCO [5]. | Corroboración visual del mismo sector. |
| Fusión | Ventana temporal configurable, mismo nodo, calidad y contexto operativo. | Prioridad explicable; no prueba de causalidad ni ilegalidad. |

| Prioridad propuesta | Condición | Acción |
| --- | --- | --- |
| Alta | Motosierra persistente + persona visible en intervalo cercano. | Revisión prioritaria; sugerir contacto territorial. |
| Media | Motosierra persistente, imagen ausente o sin persona detectada. | Crear incidente y solicitar verificación. |
| Observación | Pasos probables y/o persona, sin motosierra. | Registrar y capturar; no notificar externamente por defecto. |
| Descartado | Operador confirma confusión o actividad autorizada. | Guardar motivo para ajustar el sistema. |

Los umbrales y la persistencia se calibran; los scores no son probabilidades demostradas. Ausencia de persona no descarta corte. Viento, lluvia, tráfico y pisadas sobre distintos suelos pueden confundir el audio. No inferir quién porta una motosierra a partir de mera coincidencia.

Se retiran aves y detección de árbol cayendo. Un LLM puede redactar el resumen desde campos existentes, pero el triage y los envíos se mantienen deterministas y revisables. IA embarcada queda como evolución medida, no capacidad ya demostrada.

## 6. Mapa y centro de comando

Mapa demostrativo de sectores con alertas reales del sensor o eventos sintéticos identificados explícitamente.

Posición: registrar manualmente coordenadas del nodo instalado. Un evento se muestra en esa ubicación: no es la posición exacta de la persona o motosierra. Los marcadores de sectores simulados llevan la etiqueta DEMO; no se presentan como nodos físicos existentes.

| Vista / función | Comportamiento esperado |
| --- | --- |
| Mapa | Marcadores por prioridad, sector y estado; filtro de fecha. Base cartográfica local o plano precargado para funcionar offline. |
| Bandeja | Agrupar repeticiones por nodo y periodo; mostrar alertas nuevas, en revisión, asignadas y cerradas. |
| Ficha | ID, hora y zona, audio, foto, scores, explicación del triage, calidad y último contacto. |
| Acciones | Escuchar, ver imagen, cambiar prioridad con motivo, descartar, asignar contacto, aprobar envío. |
| Trazabilidad | Registrar quién revisó, qué mensaje se envió, destinatario, estado del proveedor y confirmación humana. |
| Privacidad | Acceso al centro y evidencia restringido; retención corta definida para el piloto; sin reconocimiento facial. |

Estados: candidato → pendiente de revisión → descartado o verificado para inspección → asignado → atendido/cerrado. El envío tiene estados independientes: pendiente de conexión, en cola, enviado, entregado, fallido. “Entregado” no equivale a “atendido”.

Stack: firmware ESP-IDF/Arduino-ESP32; puente USB serie binario; Python/FastAPI para ingestión e IA; SQLite y archivos locales; React/Next.js local; mapa con recursos precargados. La URL pública sincroniza eventos cuando hay Internet y no sustituye el centro offline.

Prueba esencial: desconectar WAN manteniendo el Archer encendido. El mapa precargado, la inferencia y las fichas siguen funcionando. Al desconectar el nodo, el centro debe marcarlo como desconectado, no interpretar falta de paquetes como ausencia de actividad.

## 7. WhatsApp: informar para actuar

Canal principal: WhatsApp a personas configuradas por sector. SMS queda como respaldo opcional, no como compra adicional de hardware.

Qué enviar: prioridad y motivo, ID, sector, hora, ubicación del nodo, resumen de evidencias, solicitud concreta y forma de confirmar. Adjuntar una imagen útil y un clip breve si el proveedor lo permite; evitar inundar al contacto con cada ventana de audio.

```text
BOSQUE ESCUCHA · DEMO · BE-014

Prioridad ALTA · Sector A · Nodo A01 · 22:47 PET
Sonido compatible con motosierra en varias ventanas.
Persona visible en imagen del mismo sector.
Evento revisado por operador; requiere inspección.

Ubicación: [coordenadas registradas del nodo]
Evidencia: [enlace público con acceso controlado]
¿Puedes verificar el sector y confirmar recepción?

Acciones: RECIBIDO · EN REVISIÓN · ATENDIDO
```

Los botones dependen del proveedor y del tipo de mensaje habilitado. Si no están disponibles, usar un enlace al incidente o respuestas de texto con ID. No enviar a entidades o personas no acordadas para la demo.

Enrutamiento: tabla sector → contacto primario → suplente. Tras revisión, el operador aprueba el envío. Si no hay reconocimiento en un plazo configurable, sugerir escalamiento al suplente; no disparar mensajes masivos. Respetar horarios y protocolos definidos por el piloto.

Conectividad: enviar por API de WhatsApp requiere salida a Internet, credenciales y plantillas/condiciones del proveedor cuando correspondan. Sin Internet, persistir la cola y mostrar el estado. SMS por API también requiere Internet en la base. No existe envío externo offline con el hardware actual.

Subir evidencia autorizada antes de enlazarla: una dirección 192.168.x.x no sirve fuera de la red local. Usar ID único de envío, deduplicación y reintentos limitados; procesar confirmaciones del proveedor y respuestas humanas por separado.

## 8. Plan de ejecución y aceptación

Orden de trabajo: validar el nodo integrado, luego el puente, después la experiencia de revisión y WhatsApp. No se requieren relés ni pantallas.

| Paso | Prueba de salida |
| --- | --- |
| 1 · Nodo | Confirmar placa y alimentación. Grabar WAV con un INMP441; tomar JPEG. Probar I²S1 junto a cámara. |
| 2 · Puente | Audio y foto atraviesan Wi-Fi → ESP32 receptor → USB → laptop. Medir bytes/s y pérdida. |
| 3 · IA | Motosierra y pasos evaluados con controles; detector visual dibuja persona cuando la reconoce. |
| 4 · Comando | Marcador DEMO, ficha de evidencia, triage y asignación. Mostrar nodo desconectado. |
| 5 · WhatsApp | Aprobación del operador y recepción en número acordado; confirmación vinculada al ID. |
| 6 · Resiliencia | Cortar Internet, generar evento, reconectar y comprobar envío único. |

Metas a verificar: incidente local en menos de 10 s bajo condiciones de demo; 20 ensayos variados con aciertos y errores registrados; un ciclo completo de envío/confirmación. No presentar estas metas como resultados. Probar pasos como capacidad experimental si su desempeño no es suficiente.

Demo: conversación/ruido de fondo → sin alerta de corte; pasos → observación; persona → foto; motosierra persistente → incidente; operador → WhatsApp; caída de Internet → cola visible. Etiquetar audio reproducido y coordenadas simuladas.

Inventario: un ESP32-CAM, un ESP32 normal receptor, INMP441 (uno inicial, segundo opcional, dos repuestos), Archer C50 y fuente, jumpers, protoboards, alimentación del árbol y cable USB de datos para receptor. Confirmar programador del ESP32-CAM. Caja sin certificación de despliegue exterior.

Valor a validar con un usuario: que un responsable ajeno al equipo entienda la alerta, encuentre el sector y confirme una tarea. Registrar uso y feedback reales. No atribuir cobertura forestal amplia ni autonomía de batería sin mediciones.

## 9. Referencias y decisiones pendientes

Fuentes técnicas y contexto. Consultadas el 17/10/2026. El esquema es una propuesta de integración, no una certificación del montaje.

1. [Geobosques. Pérdida de bosque](https://geobosques.minam.gob.pe/geobosque/view/perdida.php)
2. [Espressif. I²S en ESP32: cámara en I²S0](https://docs.espressif.com/projects/esp-idf/en/release-v5.5/esp32/api-reference/peripherals/i2s.html)
3. [TDK INMP441: interfaz y conexión estéreo](https://invensense.tdk.com/wp-content/uploads/2015/02/INMP441.pdf)
4. [TensorFlow. YAMNet](https://www.tensorflow.org/hub/tutorials/yamnet)
5. [Ultralytics. Clases COCO](https://docs.ultralytics.com/datasets/detect/coco/)
6. [Espressif. Driver de cámara y OV3660](https://github.com/espressif/esp32-camera)
7. [TP-Link. Archer C50](https://www.tp-link.com/pe/home-networking/wifi-router/archer-c50/v5/)

### Antes de energizar el nodo integrado

Confirmar que la placa realmente conserva pinout AI-Thinker clásico; método de alimentación/programación; GPIO13/14/15 disponibles y microSD desactivada; compatibilidad de versiones del driver de cámara e I²S. La conexión propuesta reemplaza la tabla del documento anterior.

### Antes de demostrar

Fijar versiones de modelos y firmware, medir el caudal serie y probar el mapa sin Internet. Revisar licencias de modelos antes de uso comercial. Confirmar proveedor de WhatsApp y destinatario de prueba. El enlace Wi-Fi no valida rendimiento LoRa ni operación a larga distancia.

### Decisiones de producto v1.1

Nodo del árbol integrado; ESP32 receptor por USB en la base; router como intermediario; IA en laptop; motosierra como señal principal; pasos como señal secundaria experimental; persona como evidencia visual; mapa DEMO; triage humano; WhatsApp principal; SMS opcional; aves retiradas.
