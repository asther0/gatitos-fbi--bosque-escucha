import "server-only";
import { z } from "zod";
import { readJson } from "./payload";

// Reviewed sensor context stored in Atomic Memory. Reference only: it never
// feeds priority, status, notifications or evidence.
const SOURCE_SITE = "bosque-escucha";
const TIMEOUT_MS = 4000;
const RESPONSE_LIMIT = 65_536;
export const CONTEXT_LIMIT = 5;
export const CONTEXT_MAX_CHARS = 500;

export type MemoryConfig = { apiUrl: string; apiKey: string };
export type NodeContext = { id: string; content: string; saved_at: string | null; incident_id: string | null };

export class MemoryUnavailable extends Error {}

type MemoryEnv = Record<string, string | undefined>;

export function memoryConfig(env: MemoryEnv = process.env): MemoryConfig | null {
  const apiUrl = env.ATOMICMEMORY_API_URL?.trim();
  const apiKey = env.ATOMICMEMORY_API_KEY?.trim();
  if (!apiUrl || !apiKey) return null;
  try {
    const url = new URL(apiUrl);
    const localHttp = url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
    if (url.protocol !== "https:" && !localHttp) return null;
  } catch { return null; }
  return { apiUrl: apiUrl.replace(/\/+$/, ""), apiKey };
}

// The memory subject is the sensor recorded on the incident row, never a value
// from the browser. One subject per node keeps each sensor's context apart.
export function nodeSubject(nodeId: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(nodeId)) throw new Error("Nodo inválido");
  return `${SOURCE_SITE}:nodo:${nodeId}`;
}

export const contextNote = z.string().trim().min(3).max(CONTEXT_MAX_CHARS);

const metadataSchema = z.object({ bosque_node_id: z.string().optional(), bosque_incident_id: z.string().optional() }).passthrough();
const searchSchema = z.object({
  memories: z.array(z.object({
    id: z.string(), content: z.string(),
    created_at: z.string().nullish(), metadata: metadataSchema.nullish(),
  })).default([]),
});
const ingestSchema = z.object({ stored_memory_ids: z.array(z.string()) });
const deleteSchema = z.object({ success: z.literal(true) });

async function call(config: MemoryConfig, path: string, init: { method: string; body?: unknown }): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${config.apiUrl}${path}`, {
      method: init.method,
      headers: { Authorization: `Bearer ${config.apiKey}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store", redirect: "error",
    });
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new MemoryUnavailable(timeout ? "Atomic Memory no respondió a tiempo." : "No se pudo conectar con Atomic Memory.");
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new MemoryUnavailable(`Atomic Memory respondió ${response.status}.`);
  try {
    // Bound untrusted provider output like the assistant route does.
    const requestInit = { method: "POST", body: response.body, duplex: "half" };
    return await readJson(new Request("https://response.local", requestInit), RESPONSE_LIMIT);
  } catch { throw new MemoryUnavailable("Atomic Memory devolvió una respuesta inválida."); }
}

export async function searchNodeContext(config: MemoryConfig, input: { nodeId: string; query: string }): Promise<NodeContext[]> {
  const body = await call(config, "/v1/memories/search/fast", { method: "POST", body: {
    user_id: nodeSubject(input.nodeId), query: input.query.slice(0, 500) || "contexto del sensor",
    source_site: SOURCE_SITE, limit: CONTEXT_LIMIT,
  } });
  const parsed = searchSchema.safeParse(body ?? {});
  if (!parsed.success) throw new MemoryUnavailable("Atomic Memory devolvió una respuesta inválida.");
  return parsed.data.memories
    // Defense in depth: drop anything not written for this sensor.
    .filter(m => m.metadata?.bosque_node_id === input.nodeId)
    .slice(0, CONTEXT_LIMIT)
    .map(m => ({
      id: m.id, content: m.content.slice(0, CONTEXT_MAX_CHARS), saved_at: m.created_at ?? null,
      incident_id: typeof m.metadata?.bosque_incident_id === "string" ? m.metadata.bosque_incident_id : null,
    }));
}

/** Returns the stored memory id. Throws unless the provider confirms storage. */
export async function saveNodeContext(config: MemoryConfig, input: { nodeId: string; incidentId: string; note: string }): Promise<string> {
  const body = await call(config, "/v1/memories/ingest/quick", { method: "POST", body: {
    user_id: nodeSubject(input.nodeId), conversation: contextNote.parse(input.note),
    source_site: SOURCE_SITE, skip_extraction: true, content_class: "summary",
    metadata: { bosque_node_id: input.nodeId, bosque_incident_id: input.incidentId },
  } });
  const parsed = ingestSchema.safeParse(body);
  const id = parsed.success ? parsed.data.stored_memory_ids[0] : undefined;
  if (!id) throw new MemoryUnavailable("Atomic Memory no confirmó el guardado.");
  return id;
}

/** True when deleted, false when the memory does not exist for this sensor. */
export async function deleteNodeContext(config: MemoryConfig, input: { nodeId: string; memoryId: string }): Promise<boolean> {
  const id = z.string().uuid().parse(input.memoryId);
  const body = await call(config, `/v1/memories/${id}?user_id=${encodeURIComponent(nodeSubject(input.nodeId))}`, { method: "DELETE" });
  if (body === null) return false;
  if (!deleteSchema.safeParse(body).success) throw new MemoryUnavailable("Atomic Memory no confirmó la eliminación.");
  return true;
}
