## Inicio sencillo del MVP en esta Mac

Abrir **Iniciar MVP.command** con doble clic desde la raíz del proyecto. El iniciador reutiliza el entorno Python instalado, cierra una instancia anterior reconocida del centro de este proyecto, habilita la recepción LAN y abre el panel en `http://127.0.0.1:8765` con acceso automático. La ventana del iniciador debe permanecer abierta. El acceso automático usa un fragmento de URL que la página borra inmediatamente; el token no se incluye en las peticiones URL. Tras validar el acceso se conserva en sessionStorage de esa pestaña para permitir recargas; una respuesta 401 lo elimina. Para abrir otra sesión se usa el iniciador.

1. Conectar Mac al Wi-Fi 2,4 GHz del TP-Link; dejar ESP32 por USB y cerrar el monitor serial de Arduino.
2. Abrir el iniciador. Si hace falta, desplegar **Configurar Wi-Fi**, indicar red y clave, y pulsar **Conectar ESP32**. Se detecta la IP actual; no se guarda la contraseña en la laptop. Con firmware protocolo 2, si DHCP cambió la IP de la Mac, el panel actualiza el destino por USB automáticamente al probar o activar escucha, siempre que ambos estén en la misma subred.
3. Pulsar **Probar motosierra**: reproduce la muestra local en los altavoces y ordena la captura del micrófono durante la reproducción. La evidencia sigue viajando por Wi-Fi desde la placa. No se inyecta una detección ni se envía el archivo de muestra directamente al clasificador. El resultado se muestra en la página y se puede escuchar la captura real.
4. **Activar escucha** habilita clips de 3 segundos cada 5 segundos; **Detener escucha** lo desactiva en la placa. No equivale a escucha continua. Tras reiniciar el ESP32 permanece apagada hasta que pulses el botón otra vez.

Los controles de hardware requieren token y acceso desde loopback en la Mac. La recepción del ESP32 acepta el token por la LAN. El centro local no envía WhatsApp: tras sincronizar, una captura física `DEMO-ESP32-WIFI` puede revisarse y enviarse como simulacro explícito desde el centro web al destinatario de prueba configurado. La alerta hablada usa `say` de macOS y solo se solicita para una detección persistente. Sin Internet funcionan recepción, análisis y revisión locales; los servicios cloud requieren reconexión. La muestra `.local/wws-chainsaw-clip.wav` y los modelos ya instalados son necesarios para la prueba sin Internet. El panel avisa si falta el audio o hay una red/IP incorrecta.

Verificación de interfaz y controles: `local-center/test_mvp_controls.py` cubre autorización local, coordinación reproducción/captura, restitución de modo automático y rechazo de otra IP. Esas pruebas usan un serial simulado; la validación acústica real sigue dependiendo del montaje.

# Centro local Bosque Escucha

Centro autónomo para laptop, sin necesidad de Internet: SQLite, archivos de evidencia, revisión humana, triage determinista y cola persistente. La interfaz y su plano esquemático se sirven localmente. El plano muestra únicamente coordenadas configuradas; no representa una cartografía geográfica de precisión.

## Ejecutar

```bash
cd local-center
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app:app --host 127.0.0.1 --port 8765
```

Abrir `http://127.0.0.1:8765`. Pegar el contenido de `data/.token` en la pantalla de acceso. Se genera una sola vez con permisos 0600, o se usa `LOCAL_CENTER_TOKEN` si está definido. El token queda en memoria de la pestaña. No publicar este puerto. Evidencia, SQLite y tokens están excluidos de Git.

La conexión local requiere el token en todas las operaciones API, incluidas lecturas y audio/foto; `/health` solo informa disponibilidad. No hay credenciales cloud en la interfaz. Usuarios locales que accedan al disco de esta cuenta pueden leer SQLite y evidencia: usar una cuenta de laptop restringida durante el piloto. Definir y ejecutar la retención acordada de `data/` antes del piloto; aún no hay borrado automático.

La interfaz permite crear demos explícitas, revisar evidencias, verificar, descartar con motivo, asignar contacto, cambiar prioridad con motivo y cerrar. Un nodo que no reporta en 30 segundos figura desconectado; falta de paquetes no equivale a ausencia de actividad. El refresco durante una revisión es manual para no destruir el texto que escribe el operador.

## Integración con Bill

**El puente USB binario del PRD está pendiente de acordar e implementar.** No se da por probado ni completo. Contrato físico objetivo: PCM mono 16 bit / 16 kHz, JPEG 320×240 ocasional, prioridad audio, USB 921600. Bill debe definir junto al equipo delimitación, endianess, checksum, fragmentación JPEG, secuencia, ACK, límites y reintentos. No enviar PCM crudo a `serial_bridge.py`.

La integración disponible ahora es **HTTP local para WAV/JPEG y metadatos**, y un puente serial **diagnóstico JSONL solo metadatos**. La laptop se mantiene en loopback; un ESP conectado por Wi-Fi no alcanza `127.0.0.1`. Para pruebas Wi-Fi directas, ejecutar deliberadamente en la interfaz LAN, con token, red confiable y firewall, y declarar ese modo diagnóstico en la demo.

Ejemplo desde terminal de la laptop:

```bash
export LOCAL_CENTER_TOKEN="$(cat data/.token)"
curl -X PUT http://127.0.0.1:8765/api/nodes/A01 \
  -H "Authorization: Bearer $LOCAL_CENTER_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Árbol A01","sector":"Sector A","latitude":-12.1,"longitude":-69.2}'
# Usa coordenadas reales medidas; las anteriores son solo ilustrativas.
curl http://127.0.0.1:8765/api/evidence \
  -H "Authorization: Bearer $LOCAL_CENTER_TOKEN" -F node_id=A01 -F file=@clip.wav
```

El upload responde `{path,type}`. Enviar luego:

```json
{
  "event_id": "a25b9737-3bb8-46d8-af97-801ff15ed704",
  "node_id": "A01",
  "event_type": "chainsaw",
  "confidence": 0.82,
  "persistent": true,
  "detected_at": "2026-10-17T22:00:00-05:00",
  "source": "local_center",
  "evidence_path": "HASH_DEVUELTO.wav",
  "evidence_type": "audio",
  "metadata": {"model": "yamnet", "windows": 3}
}
```

POST a `/api/events` con `Authorization: Bearer ...`. `event_id` debe mantenerse estable en los reintentos; la API devuelve el evento existente sin duplicar incidentes. No declarar `persistent:true` para una ventana sin evaluación de persistencia. Upload admite JPEG/PNG/WAV hasta 4 MB, identificado por cabecera. El nodo captura; la laptop clasifica.

`pip install pyserial` activa el diagnóstico serial:

```bash
python serial_bridge.py --port /dev/cu.usbserial-1140 --baud 921600
```

Cada línea contiene un payload de evento JSON completo y UUID estable. El bridge devuelve `{"ack":"UUID"}` solo cuando el servidor acepta. El emisor debe conservar/reintentar los mensajes sin ACK. Este bridge no reemplaza la cola/buffers del firmware ni ensambla PCM/JPEG binarios.

## Modelos reales, opt-in

### Demo rápida con el INMP441 conectado al ESP32

Con el firmware `firmware/mic_test` o el nuevo `firmware/mic_wifi` cargado, el ESP32 entrega clips de 2 segundos por USB. El nuevo firmware también puede enviarlos directamente por la LAN del TP-Link; ver [firmware/mic_wifi/README.md](../firmware/mic_wifi/README.md) para el aprovisionamiento y la prueba Wi-Fi. En esta laptop el modelo YAMNet se ejecuta en Python 3.11 (nunca dentro del ESP32). El centro local ya debe estar corriendo con `AUTO_ANALYZE=1` y las rutas de YAMNet configuradas. Para escuchar, clasificar y registrar capturas bajo un nodo de demostración:

```bash
local-center/.venv-ml/bin/python local-center/mic_detect.py --count 0 --send
```

Ejecutar desde la raíz del repositorio; detener con Ctrl+C. El script muestra las tres clases principales, los puntajes de motosierra y pasos y el estado de análisis del centro. `DEMO-ESP32-MIC` evita tratar una prueba con audio reproducido como actividad de campo. Cada clip queda en `.local/ultima-captura.wav`; el centro conserva su propia copia de evidencia.

Control negativo real: el WAV de voz grabado con este INMP441 obtuvo `Speech 0.999`, `Chainsaw 0.000`, sin evento. Control positivo **de archivo**, no de captura de campo: el segundo 10–12 de [WWS Chainsaw.ogg](https://commons.wikimedia.org/wiki/File:WWS_Chainsaw.ogg), grabación de Leena Ahonen publicada bajo CC BY 4.0, convertido a WAV mono 16 kHz, obtuvo `Chainsaw 0.991` y tres ventanas consecutivas; `/api/raw` creó un incidente DEMO de prioridad media. Otro audio auténtico de motosierra, [Chainsaw 7 0.ogg](https://commons.wikimedia.org/wiki/File:Chainsaw_7_0.ogg), obtuvo solo `Chainsaw 0.235`: el modelo todavía no está calibrado para campo. En la reproducción por el altavoz, el micrófono físico generó tres detecciones `Chainsaw` con puntuaciones 0.713, 0.889 y 0.720, pero cada clip individual quedó `persistent:false`; el incidente físico DEMO quedó en observación. La distancia y el volumen influyen; no presentar esta reproducción como captura de bosque.

Validación de pasos (18 de octubre): ocho capturas del ESP32 sin estímulo controlado dieron `Walk, footsteps` entre 0.000 y 0.023; no prueban sensibilidad. Se evaluaron dos audios de pasos conocidos directamente como archivos: [Walking-on-gravel-38827.ogg](https://commons.wikimedia.org/wiki/File:Walking-on-gravel-38827.ogg) dio 0.589 y [ZapSibAudio-Steps.ogg](https://commons.wikimedia.org/wiki/File:ZapSibAudio-Steps.ogg) dio 0.118, ambos por debajo del umbral 0.65. Después se reprodujo el primero por el altavoz y el ESP32 captó tres clips: 0.005, 0.008 y 0.024; ningún evento. Por ahora **no presentar detección de pasos como validada**. Hace falta audio positivo captado por este montaje y evaluación de falsos positivos antes de cambiar el umbral.

### Instalación y modelos

Las dependencias de IA son pesadas y dependen de la versión Python/CPU. Se recomienda un entorno separado **Python 3.11** para TensorFlow; el entorno web puede usar otro Python. No se instalan modelos durante el arranque y nunca se simula una detección por ausencia de modelo.

Audio: instalar las dependencias fijadas en `requirements-ml.txt` y ejecutar `setup_models.py` para obtener YAMNet SavedModel y `yamnet_class_map.csv` oficiales. El loader usa `tensorflow.saved_model.load` directamente sobre archivos locales, sin depender de TensorFlow Hub en ejecución. `AudioDetector` usa inferencia real CPU, exige WAV mono 16 kHz y evalúa Chainsaw / Walk, footsteps; umbral inicial 0.65 y 3 ventanas consecutivas para persistencia. Son parámetros iniciales pendientes de calibración, no resultados de precisión. El clip debe contener al menos 0.975 s. No compartir instancia entre nodos ni concatenar ventanas separadas por intervalos largos: la CLI crea un detector nuevo por archivo.

```bash
python analyze.py clip.wav --node A01 --kind audio --model /ruta/yamnet --class-map /ruta/yamnet_class_map.csv
```

Visión: instalar `ultralytics`; descargar pesos pequeños compatibles (p. ej. YOLO11n) y revisar licencia. El wrapper exige archivo de pesos local, usa CPU y solo clase COCO person; guarda cajas en metadata.

```bash
python analyze.py foto.jpg --node A01 --kind image --model /ruta/yolo11n.pt
```

Los wrappers están implementados; la inferencia con los modelos y capturas de Bill debe validarse en la laptop antes de afirmar detección integrada. IA no identifica personas ni determina ilegalidad. Triage: motosierra persistente + persona mismo nodo y mismo origen en 120 s → alta; motosierra persistente → media; otros indicios → observación. Ambient no crea incidente. Una prioridad editada por el operador se conserva; incidentes ya revisados no se reclasifican.

## Sincronización y WhatsApp

Variables opcionales, solo en entorno del servidor:

```text
CLOUD_BASE_URL=https://tu-despliegue.vercel.app
CENTER_SYNC_TOKEN=token-compartido-con-cloud
N8N_NOTIFY_WEBHOOK=https://tu-n8n/webhook/bosque
N8N_WEBHOOK_TOKEN=token-del-webhook
NOTIFICATION_CALLBACK_SECRET=token-callback-del-proveedor
```

El worker envía snapshots a `POST CLOUD_BASE_URL/api/sync` con UUID estables, Bearer token y reintentos sin límite para la sincronización (máximo 15 segundos entre intentos fallidos). **La sincronización nunca dispara notificaciones.** Antes del snapshot, sube la evidencia por `/api/evidence` con `CENTER_SYNC_TOKEN`; guarda en SQLite la correspondencia entre archivo local y path privado cloud para reutilizarlo. El snapshot conserva `metadata.local_evidence_path` como procedencia y usa el path cloud para acceder con autenticación. Una subida fallida retiene el trabajo para reintentar; el centro local sigue permitiendo escuchar/ver sus archivos sin Internet. Los escenarios sintéticos integrados (`DEMO-01`, `source=demo`) quedan locales. Una captura WAV real subida a `DEMO-ESP32-WIFI` sí se sincroniza para la demostración y aparece al pulsar **Ver pruebas del ESP32** en el Command Center. Solo tras revisión humana y clic explícito puede salir como simulacro de WhatsApp al único destinatario de prueba configurado en la nube.

WhatsApp: primero verificar y asignar un contacto acordado; luego aprobar explícitamente. Se genera una notificación única por incidente y una tarea persistente. Sin webhook configurado sigue en cola. El webhook recibe `{notification,incident,recipient}`, token Bearer e `Idempotency-Key` igual al UUID de notificación. n8n debe **deduplicar persistentemente por ese UUID antes de enviar**. Una aceptación HTTP deja `queued`, registra `notification_webhook_accepted` y retira el trabajo para no volver a enviarlo: no equivale a envío ni entrega. El proveedor debe confirmar por `POST /api/notifications/callback`, con Bearer `NOTIFICATION_CALLBACK_SECRET` y `{notification_id,status,provider_id?,actor?}`. Status admite `sent`, `delivered`, `failed`, `acknowledged`; el último requiere actor y registra reconocimiento humano separado de entrega y cierre. Callbacks repetidos son idempotentes. n8n cloud no alcanza loopback: usar n8n local o acordar acceso privado; la integración cloud dispone de su propio callback. Proveedor WhatsApp y plantillas siguen pendientes.

Reintentos limitados: 8 intentos por trabajo con espera exponencial hasta 300 s. `POST /api/queue/{job_id}/retry` con token reinicia un trabajo; la clave idempotente permanece igual. La cola y errores aparecen en la interfaz. Reiniciar el servidor conserva eventos/colas. Una aprobación no envía sin conexión; restablecer conexión permite procesar la misma tarea, sujeto a deduplicación de n8n/proveedor.

## Comprobación rápida

`python smoke_sync.py` verifica con nube HTTP simulada desconexión/reconexión, un único upload persistido, paths privados y locales separados y deduplicación UUID. No necesita Internet.

`python smoke.py` usa SQLite y archivos temporales, sin Internet ni modelos. Comprueba autorización, deduplicación, correlación alta, revisión, cola única y rechazo de transiciones inválidas. No prueba ESP32, inferencia real ni entrega WhatsApp. Las pruebas de aceptación física, cortes de WAN, 20 ensayos y ciclo WhatsApp real siguen pendientes con el equipo.

## Arranque con la configuración del proyecto

```bash
python run.py --cloud-url https://TU-PROYECTO.vercel.app
# O un archivo de entorno explícito:
python run.py --env-file /ruta/repo/.env.local
```

`run.py` carga `.env.local` del repo y `local-center/.env` solo en el proceso Python; las variables existentes del shell tienen prioridad. No imprime ni expone credenciales. Escucha exclusivamente `127.0.0.1:8765`; `--port` permite cambiar puerto. No se necesita exponer un puerto a Internet para recibir USB.

## Captura cruda automática

El bridge receptor debe enviar `POST /api/raw` con Bearer `LOCAL_CENTER_TOKEN` y multipart `file`, `node_id`, `capture_id` (UUID estable por captura) y opcional `detected_at` ISO. Admite WAV mono y JPEG/PNG, máximo 4 MB. Primero guarda la evidencia y registra la captura; luego clasifica asincrónicamente si los modelos están habilitados. El reintento del mismo UUID/archivo devuelve la captura existente. UUID reutilizado para otra captura devuelve 409.

```text
AUTO_ANALYZE=1
YAMNET_MODEL_PATH=/ruta/yamnet
YAMNET_CLASS_MAP=/ruta/yamnet_class_map.csv
YOLO_MODEL_PATH=/ruta/yolo11n.pt
```

Sin configuración/modelos, responde `analysis_status: blocked` y `analysis_error` explícito, conservando la evidencia. Un fallo de dependencia o inferencia queda `failed` en la captura y aparece en el dashboard; no genera eventos simulados. Con modelos, el worker produce eventos reales con UUID derivados de captura/clase para evitar duplicaciones. Sin detecciones, la captura queda `complete` con cero detecciones. Para reintentar tras corregir configuración: reiniciar proceso y `POST /api/captures/{capture_id}/retry` autenticado.

Los modelos se cargan una vez por proceso y el análisis se ejecuta en un hilo para mantener disponible la API. La persistencia de audio se evalúa dentro de cada clip; enviar WAV mono 16 kHz de al menos 2 segundos, preferiblemente 3 segundos. No se mezclan ventanas de nodos diferentes o clips discontinuos. Los parámetros iniciales requieren calibración con Bill.

El sync registra primero los nodos en nube, sube los blobs después y finalmente sincroniza eventos/incidentes. La cache de upload está identificada por destino cloud, nodo y hash/ruta local. Los callbacks/cloud no dependen de que los archivos tengan una URL pública. Los límites del contrato se respetan con lotes ordenados por dependencias.

No hay borrado automático de evidencia ni retención implícita. Antes del piloto, definir la retención con el equipo y una tarea explícita de limpieza; esta versión conserva los archivos para no eliminar evidencia pendiente de revisión o sincronización.

## Instalar y verificar IA offline reproducible

Usar Python **3.11** y dependencias fijadas:

```bash
python3.11 -m venv .venv-ml
.venv-ml/bin/pip install -r requirements-ml.txt
.venv-ml/bin/python setup_models.py
.venv-ml/bin/python smoke_models.py
```

`setup_models.py` descarga explícitamente YOLO11n (~5.6 MB) desde la release oficial de Ultralytics y pesos YAMNet (~15.3 MB) del bucket oficial TensorFlow AudioSet. Dado que la URL comprimida TFHub/Kaggle devolvió 404 durante la instalación, usa la arquitectura oficial TensorFlow fijada a un commit y exporta SavedModel compatible localmente. El código upstream requiere Keras 2 (`tf-keras`), separado de Keras 3. `models/provenance.json` registra URLs y SHA256; todos los assets descargados y exportados están ignorados en Git. Cada descarga está limitada a 64 MB (esto no incluye los wheels del entorno).

Fuentes primarias: [tutorial YAMNet](https://www.tensorflow.org/hub/tutorials/yamnet), [código y pesos oficiales TensorFlow](https://github.com/tensorflow/models/tree/34a21326906b9574fa11c4d6d0a5c534ff039267/research/audioset/yamnet), [documentación YOLO11](https://docs.ultralytics.com/models/yolo11/). El tutorial establece entrada mono 16 kHz y 521 clases; el código oficial usa ventanas de 0.96 s con solapamiento del 50 %. Nuestra persistencia usa tres ventanas consecutivas.

`smoke_models.py` ejecuta inferencia real CPU sobre silencio de 3 s y una imagen negra de 320×240. Verifica labels Chainsaw/Walk, footsteps, 521 clases, ausencia de eventos objetivo en esos controles y tres ventanas de persistencia. Reporta tiempos observados incluyendo carga, sin inferir precisión, sensibilidad o desempeño de campo. La validación con motosierra, personas y ruido reales del nodo sigue pendiente.


Verificación realizada en esta laptop: el control negro produjo 0 detecciones de persona; el audio sintético de 3 s produjo 6 ventanas, clase principal `Silence`, 521 clases cargadas y ningún evento motosierra/pasos. Se verificó historial de 3 ventanas negativas. Esto demuestra ejecución de los modelos y controles negativos, no precisión de detección en bosque. La persistencia reconoce cualquier tramo de tres ventanas consecutivas dentro del clip, aunque termine en silencio.

### Protección de demostraciones

Aprobar una notificación de un nodo cuyo ID comienza por `DEMO` o de un incidente que contiene cualquier evento `source=demo` registra una aprobación simulada con estado `blocked`, sin crear un trabajo de envío. El worker también bloquea y retira trabajos antiguos de demostración antes de cualquier HTTP, incluso cuando n8n está configurado. `smoke_demo_guard.py` verifica ambos casos con un webhook simulado y exige cero solicitudes externas.

Los callbacks `sent` y `delivered` requieren `provider_id` no vacío. Un callback tardío `failed` no degrada estados `sent` o `delivered`. La confirmación de envío externo de una demostración se rechaza. Los IDs de nodo configurados deben cumplir el mismo formato del contrato cloud (1–64 caracteres alfanuméricos, guion o guion bajo).

Heartbeat del firmware: `POST /api/nodes/{node_id}/heartbeat` con Bearer local y JSON `{battery_pct?: 0..100, status?: online|offline|maintenance}` actualiza último contacto sin crear eventos ni alertas. Por defecto registra `online`; crea un nodo sin coordenadas si aún no existe y preserva su configuración. El bridge solo debe trasladar STATUS del árbol, no confundir el receptor con actividad del sensor. Ingestas `/api/events` y `/api/raw` rechazan timestamps más de 60 segundos en el futuro antes de persistir archivos o registros.
