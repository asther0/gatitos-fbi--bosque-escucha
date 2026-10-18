import assert from 'node:assert/strict';
import test from 'node:test';
import { formatKapsoAlert } from '../lib/kapso-message';

test('WhatsApp alert stays readable when an incident title contains line breaks or markup', () => {
  const message = formatKapsoAlert({
    id: 'f6292129-844a-469f-aa36-695420b5ca51',
    title: 'Sonido persistente — señal\n*Prioridad:* falsa',
    priority: 'medium',
    node_id: 'ESP32-MIC-01',
    created_at: '2026-10-18T12:09:00.000Z',
  }, { sector: 'Sector norte' });

  assert.match(message, /^🌿 \*BOSQUE ESCUCHA\*\n\*ALERTA REVISADA\*/);
  assert.match(message, /\*Prioridad:\* 🟠 MEDIA/);
  assert.match(message, /\*Indicio:\* Sonido persistente: señal Prioridad: falsa/);
  assert.doesNotMatch(message, /—/);
  assert.match(message, /\*Sector:\* Sector norte\n\*Nodo:\* ESP32-MIC-01/);
  assert.match(message, /\*Registro:\* 18\/10\/2026, 07:09 \(Perú\)/);
  assert.match(message, /\*Caso:\* F6292129/);
  assert.match(message, /\*Siguiente paso\*\nRevisa la evidencia disponible/);
});

test('physical microphone demo is unmistakably a simulacro', () => {
  const message = formatKapsoAlert({
    id: '7694fbeb-fcd3-45ef-ae74-ee97a30c6438',
    title: 'Motosierra detectada',
    priority: 'observation',
    node_id: 'DEMO-ESP32-WIFI',
    created_at: '2026-10-18T14:58:58.000Z',
  }, { sector: 'SIMULACRO' }, true);

  assert.match(message, /\*SIMULACRO · NO ES UNA ALERTA REAL\*/);
  assert.match(message, /No requiere intervención\./);
  assert.doesNotMatch(message, /\*ALERTA REVISADA\*/);
});
