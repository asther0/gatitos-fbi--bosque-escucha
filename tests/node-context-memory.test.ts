import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startAtomicMemoryFixture } from "./fixtures/atomic-memory-fixture";
import { startSupabaseFixture } from "./fixtures/supabase-fixture";
import { bosqueSeed, INCIDENT_A1, INCIDENT_A2, INCIDENT_B1, NODE_A } from "./fixtures/bosque-seed";
import { createSession } from "../lib/auth";
import { memoryConfig } from "../lib/atomic-memory";
import * as route from "../app/api/incidents/[id]/context/route";

const API_KEY = "fixture-only-key";
let memory: Awaited<ReturnType<typeof startAtomicMemoryFixture>>;
let supabase: Awaited<ReturnType<typeof startSupabaseFixture>>;
let cookie = "";

before(async () => {
  memory = await startAtomicMemoryFixture({ apiKey: API_KEY });
  supabase = await startSupabaseFixture({ tables: bosqueSeed() });
  process.env.SESSION_SECRET = "test-only-session-secret";
  process.env.SUPABASE_URL = supabase.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture-service-role";
  cookie = `bosque_operator=${createSession()}`;
});
beforeEach(() => {
  process.env.ATOMICMEMORY_API_URL = memory.url;
  process.env.ATOMICMEMORY_API_KEY = API_KEY;
  memory.setMode("ok");
  memory.memories.splice(0);
  memory.requests.splice(0);
});
after(async () => { await memory.close(); await supabase.close(); });

const call = async (method: "GET" | "POST" | "DELETE", incident: string, body?: unknown, auth = true) => {
  const request = new Request(`http://127.0.0.1:4601/api/incidents/${incident}/context`, {
    method, headers: { ...(auth ? { cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const response = await route[method](request, { params: Promise.resolve({ id: incident }) });
  return { status: response.status, body: await response.json() };
};

test("feature is off without server credentials and never calls the provider", async () => {
  delete process.env.ATOMICMEMORY_API_URL;
  delete process.env.ATOMICMEMORY_API_KEY;
  assert.deepEqual((await call("GET", INCIDENT_A2)).body, { enabled: false, items: [] });
  const saved = await call("POST", INCIDENT_A2, { note: "Generador del campamento a las 6:00." });
  assert.equal(saved.status, 503);
  assert.equal(saved.body.saved, false);
  assert.equal(memory.requests.length, 0);
});

test("only operators can read or write sensor context", async () => {
  assert.equal((await call("GET", INCIDENT_A2, undefined, false)).status, 401);
  assert.equal((await call("POST", INCIDENT_A2, { note: "Nota sin sesión" }, false)).status, 401);
  assert.equal(memory.requests.length, 0);
});

test("context saved while reviewing one incident is recalled on the next incident of the same sensor", async () => {
  const saved = await call("POST", INCIDENT_A1, { note: "Generador del campamento suena entre 6:00 y 7:00; confirmar con guardaparque." });
  assert.equal(saved.status, 201);
  assert.equal(saved.body.saved, true);
  const ingest = memory.requests.find(r => r.path === "/v1/memories/ingest/quick")!;
  assert.equal(ingest.body.user_id, `bosque-escucha:nodo:${NODE_A}`);
  assert.equal(ingest.body.skip_extraction, true);
  assert.equal("session_id" in ingest.body, false, "never scopes by a shared thread");

  const recalled = await call("GET", INCIDENT_A2);
  assert.equal(recalled.status, 200);
  assert.equal(recalled.body.items.length, 1);
  assert.match(recalled.body.items[0].content, /Generador del campamento/);
  assert.equal(recalled.body.items[0].incident_id, INCIDENT_A1);
});

test("another sensor never sees or deletes that context, and the browser cannot pick the sensor", async () => {
  const saved = await call("POST", INCIDENT_A1, { note: "Contexto exclusivo del sensor A.", node_id: "FIXTURE-ESP32-B" });
  assert.equal(memory.memories[0].user_id, `bosque-escucha:nodo:${NODE_A}`);
  assert.deepEqual((await call("GET", INCIDENT_B1)).body.items, []);
  const denied = await call("DELETE", INCIDENT_B1, { memory_id: saved.body.id });
  assert.equal(denied.status, 404);
  assert.equal(denied.body.deleted, false);
  assert.equal(memory.memories.length, 1);
});

test("operators can correct and delete saved context", async () => {
  const first = await call("POST", INCIDENT_A1, { note: "Generador a las 6:00." });
  const corrected = await call("POST", INCIDENT_A2, { note: "Generador a las 18:00, no a las 6:00.", replaces: first.body.id });
  assert.equal(corrected.body.saved, true);
  assert.equal(corrected.body.replaced, true);
  assert.deepEqual((await call("GET", INCIDENT_A2)).body.items.map((i: { content: string }) => i.content), ["Generador a las 18:00, no a las 6:00."]);
  const removed = await call("DELETE", INCIDENT_A2, { memory_id: corrected.body.id });
  assert.deepEqual(removed.body, { enabled: true, deleted: true });
  assert.deepEqual((await call("GET", INCIDENT_A2)).body.items, []);
});

test("provider failures are reported as not saved", async () => {
  memory.setMode("error");
  const read = await call("GET", INCIDENT_A2);
  assert.equal(read.status, 502);
  assert.equal(read.body.enabled, true);
  const saved = await call("POST", INCIDENT_A2, { note: "No debería figurar como guardado." });
  assert.equal(saved.status, 502);
  assert.equal(saved.body.saved, false);
  memory.setMode("unconfirmed");
  const unconfirmed = await call("POST", INCIDENT_A2, { note: "Respuesta sin identificador." });
  assert.equal(unconfirmed.body.saved, false);
});

test("a hanging provider is cut off and reported as not saved", async () => {
  memory.setMode("hang");
  const started = Date.now();
  const saved = await call("POST", INCIDENT_A2, { note: "Proveedor sin respuesta." });
  assert.equal(saved.body.saved, false);
  assert.match(saved.body.error, /a tiempo/);
  assert.ok(Date.now() - started < 6000);
});

test("rejects unknown incidents, invalid notes and insecure provider URLs", async () => {
  assert.equal((await call("GET", "6f0c4f5e-0d3a-4c51-9a55-ffffffffffff")).status, 404);
  assert.equal((await call("POST", INCIDENT_A2, { note: "x" })).status, 400);
  assert.equal((await call("POST", INCIDENT_A2, { note: "y".repeat(501) })).status, 400);
  assert.equal(memoryConfig({ ATOMICMEMORY_API_URL: "http://memory.example.com", ATOMICMEMORY_API_KEY: "k" }), null);
  assert.ok(memoryConfig({ ATOMICMEMORY_API_URL: "https://api.atomicstrata.ai/", ATOMICMEMORY_API_KEY: "k" }));
  assert.equal(memoryConfig({ ATOMICMEMORY_API_URL: "ftp://localhost", ATOMICMEMORY_API_KEY: "k" }), null);
  assert.equal(memory.requests.length, 0);
});
