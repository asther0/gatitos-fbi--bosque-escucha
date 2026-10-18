// Focused integration smoke. Creates explicitly DEMO records; never sends external messages.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
if (fs.existsSync('.env.local')) process.loadEnvFile('.env.local');
const base = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
let cookie = '';
async function request(path, method = 'GET', body, authenticated = true) {
  const response = await fetch(base + path, {
    method, headers: { ...(authenticated && cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json();
  return { response, json };
}
let r = await request('/api/events', 'POST', {}, false);
assert.equal(r.response.status, 401);
r = await request('/api/session', 'POST', { password: process.env.OPERATOR_PASSWORD });
assert.equal(r.response.status, 200, JSON.stringify(r.json));
cookie = r.response.headers.get('set-cookie').split(';')[0];
r = await request('/api/nodes', 'POST', { id: 'DEMO-01', name: 'Árbol de demostración', sector: 'Sector A · Coordenadas simuladas', latitude: -12.836, longitude: -69.286 });
assert.equal(r.response.status, 200, JSON.stringify(r.json));
const event = { event_id: crypto.randomUUID(), node_id: 'DEMO-01', source: 'demo', event_type: 'chainsaw', confidence: .88, persistent: true, metadata: { simulated: true, purpose: 'Prueba funcional, señal sintética' } };
r = await request('/api/events', 'POST', event);
assert.equal(r.response.status, 201, JSON.stringify(r.json));
const eventId = r.json.event.id;
r = await request('/api/events', 'POST', event);
assert.equal(r.json.event.id, eventId);
r = await request('/api/events', 'POST', { ...event, event_id: crypto.randomUUID(), event_type: 'person', persistent: false });
assert.equal(r.json.incident.priority, 'high');
const incident = r.json.incident.id;
r = await request(`/api/incidents/${incident}`, 'PATCH', { status: 'closed', review_note: 'Invalid transition smoke' });
assert.equal(r.response.status, 409);
r = await request(`/api/incidents/${incident}`, 'PATCH', { priority: 'medium', review_note: 'DEMO: ajuste humano para comprobar conservación de prioridad.' });
assert.equal(r.response.status, 200, JSON.stringify(r.json));
r = await request('/api/events', 'POST', { ...event, event_id: crypto.randomUUID(), event_type: 'person' });
assert.equal(r.json.incident.priority, 'medium');
r = await request(`/api/incidents/${incident}`, 'PATCH', { status: 'verified', review_note: 'DEMO: revisión del circuito de inspección, sin evento de campo.' });
assert.equal(r.response.status, 200, JSON.stringify(r.json));
r = await request(`/api/incidents/${incident}/notify`, 'POST', { approved: true });
assert.equal(r.response.status, 202, JSON.stringify(r.json));
const notification = r.json.notification.id;
r = await request(`/api/incidents/${incident}/notify`, 'POST', { approved: true });
assert.equal(r.json.notification.id, notification);
r = await request('/api/dashboard');
assert.equal(r.json.events.filter(e => e.id === eventId).length, 1);
assert.equal(r.json.notifications.filter(n => n.id === notification).length, 1);
r = await request('/api/dashboard', 'GET', undefined, false);
assert.ok(r.json.nodes.every(n => n.id === 'DEMO-01'));
assert.ok(r.json.events.every(e => e.source === 'demo'));
assert.ok(r.json.incidents.every(i => !i.assigned_to && !i.review_note));
const anonymousEvidence = await fetch(base + '/api/evidence?path=DEMO-01/00000000-0000-4000-8000-000000000000.wav');
assert.equal(anonymousEvidence.status, 401);
// A synthetic tone verifies storage/playback only; it is explicitly not a chainsaw recording.
const pcm = Buffer.alloc(16000 * 2);
for (let i = 0; i < 16000; i++) pcm.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * i / 16000) * 2000), i * 2);
const wav = Buffer.alloc(44 + pcm.length);
wav.write('RIFF'); wav.writeUInt32LE(36 + pcm.length, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(pcm.length, 40); pcm.copy(wav, 44);
async function upload() {
  const form = new FormData(); form.append('node_id','DEMO-01'); form.append('file',new Blob([wav],{type:'audio/wav'}),'demo-tone.wav');
  const response = await fetch(base+'/api/evidence',{method:'POST',headers:{Cookie:cookie},body:form});
  const body=await response.json();assert.ok(response.ok,JSON.stringify(body));return body;
}
const evidence = await upload(); const duplicateEvidence = await upload(); assert.equal(duplicateEvidence.path,evidence.path);
const playback=await fetch(base+'/api/evidence?path='+encodeURIComponent(evidence.path),{headers:{Cookie:cookie}});
assert.equal(playback.status,200); assert.match(playback.headers.get('content-type'),/audio/);assert.equal((await playback.arrayBuffer()).byteLength,wav.length);
r=await request('/api/events','POST',{event_id:crypto.randomUUID(),node_id:'DEMO-01',source:'demo',event_type:'ambient',confidence:0,evidence_path:evidence.path,evidence_type:'audio',metadata:{simulated:true,description:'Tono sintético 220 Hz para verificar reproducción, no es grabación de bosque ni clasificación IA.'}});
assert.ok(r.response.ok,JSON.stringify(r.json));
r=await request('/api/demo','POST',{scenario:'combined'});assert.equal(r.response.status,201);
console.log('PASS: authentication, real Supabase persistence, UUID dedupe, correlated triage, human override, transitions, notification dedupe, public isolation, evidence authorization.');
console.log('PASS: private WAV upload, binary dedupe, signed playback and synthetic demo scenario.');
console.log('DEMO incident:', incident);
