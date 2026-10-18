# Bosque Escucha

Vigilancia del bosque con evidencia acústica y visual, revisión humana y coordinación de inspecciones. Hack the Andes 2026 · Clima y Territorio.

**Centro público:** https://bosque-escucha.vercel.app · **Repositorio:** https://github.com/asther0/gatitos-fbi--bosque-escucha

El [PRD convertido a Markdown](docs/Bosque_Escucha_PRD_MVP.md) conserva las nueve secciones del PDF original.

## Arquitectura

```text
ESP32-CAM + micrófono → Wi-Fi 2,4 GHz / router → ESP32 receptor USB
                                                        ↓
Laptop: FastAPI + SQLite + evidencias + IA local + revisión humana
                   ↓ sincronización cuando existe Internet
Supabase (RLS + Storage privado) ← API Next.js → Centro web en Vercel
                   ↓ solo tras aprobación y contacto configurado
                 Cola → n8n/proveedor → WhatsApp
```

La aplicación pública muestra exclusivamente registros DEMO. Los datos reales, audios e imágenes requieren acceso de operador. Las coordenadas pertenecen al nodo registrado: no localizan con precisión una persona ni una motosierra. Los scores no son probabilidades calibradas de ilegalidad.

## Ejecutar web

Requiere Node.js 22 o posterior. En Vercel se utiliza Node.js 24.

```bash
npm ci
cp .env.example .env.local
# Completar variables privadas del servidor.
npm run dev
```

En esta laptop `.env.local` ya está configurado y excluido de Git: **no sobrescribirlo**. El acceso de operador usa `OPERATOR_PASSWORD`; ningún secreto de Supabase se envía al navegador. No hace falta una API key de OpenStreetMap. La cartografía necesita Internet; ante un fallo se ofrece un plano esquemático local.

Las migraciones SQL están en `supabase/migrations/`. Habilitan RLS sin acceso anónimo a las tablas y crean un bucket privado. La API controla lectura y escritura. No existe registro público de operadores.

## Centro local

Consultar [guía del centro local](local-center/README.md) para ejecutar FastAPI, preparar modelos y probar offline. `python local-center/run.py --cloud-url https://bosque-escucha.vercel.app` carga las variables del servidor desde `.env.local`, si las dependencias están instaladas.

Los eventos y archivos se conservan en SQLite/disco. La sincronización registra nodos, sube evidencias y replica snapshots con UUID estables. La cola sobrevive a reinicios. Inferencia y transporte físico deben verificarse con las capturas reales de Bill; las demostraciones sintéticas siempre están marcadas.

## Módulos

| Módulo | Ruta |
| --- | --- |
| Centro de comando, mapa y revisión | `components/`, `app/` |
| API, autorización y procesamiento | `app/api/`, `lib/` |
| Base de datos y reglas transaccionales | `supabase/migrations/` |
| Ingesta, evidencia, IA y cola offline | `local-center/` |
| Receptor ESP32, protocolo BESC y puente USB | [firmware/README.md](firmware/README.md) |
| Contrato de dispositivo, sync y notificaciones | [docs/API.md](docs/API.md) |
| Sponsors y decisiones de herramientas | [docs/SPONSORS.md](docs/SPONSORS.md) |

## Verificación rápida

```bash
npm run typecheck
npm run build
npm run test:unit
# Contra un servidor en ejecución; genera únicamente registros DEMO:
node scripts/smoke-cloud.mjs
# O contra el despliegue público:
SMOKE_BASE_URL=https://bosque-escucha.vercel.app node scripts/smoke-cloud.mjs
```

Los smoke locales usan SQLite temporal y una nube simulada: `python local-center/smoke.py` y `python local-center/smoke_sync.py`. No hay suite e2e de navegador. Las pruebas incluyen persistencia Supabase, idempotencia, correlación, conservación de prioridad humana, estados, aislamiento público y reproducción privada de WAV.

## Pendientes de integración externa

- Configurar la instancia n8n, proveedor WhatsApp y destinatario acordado. Aceptación del webhook, entrega del proveedor y confirmación humana son estados diferentes. No se han enviado mensajes externos.
- Conectar y medir el nodo de Bill con cámara/micrófono y el receptor USB; calibrar umbrales y ejecutar ensayos de campo.
- Probar el corte real de WAN manteniendo el router encendido; los tests de reconexión simulados no sustituyen esta aceptación física.
- Definir retención y accesos del piloto antes de capturar personas en campo.

La interfaz permite reintentar la cola de notificaciones explícitamente. No se afirma un servicio programado de reintentos cloud hasta configurar el disparador n8n. Los créditos de sponsors requieren su activación con la organización.
