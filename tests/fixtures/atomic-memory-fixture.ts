// FIXTURE ONLY: local stand-in for the documented Atomic Memory HTTP routes
// used by Bosque Escucha. It is not Atomic Memory and does no semantic ranking:
// search returns the newest records of the requested user_id.
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

export type FixtureMemory = { id: string; user_id: string; content: string; source_site: string; metadata: Record<string, unknown>; created_at: string };
export type FixtureMode = "ok" | "error" | "hang" | "unconfirmed";

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

export async function startAtomicMemoryFixture({ apiKey, port = 0 }: { apiKey: string; port?: number }) {
  const memories: FixtureMemory[] = [];
  const requests: { method: string; path: string; body: Record<string, unknown> }[] = [];
  let mode: FixtureMode = "ok";
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://fixture.local");
    const send = (status: number, payload: unknown) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(payload));
    };
    const payload = await body(request);
    requests.push({ method: request.method || "", path: url.pathname + url.search, body: payload });
    if (mode === "hang") return;
    if (mode === "error") return send(500, { error: "fixture failure" });
    if (request.headers.authorization !== `Bearer ${apiKey}`) return send(401, { error: "unauthorized" });
    if (request.method === "POST" && url.pathname === "/v1/memories/ingest/quick") {
      if (mode === "unconfirmed") return send(200, { episode_id: randomUUID(), memories_stored: 0, stored_memory_ids: [] });
      if (typeof payload.user_id !== "string" || typeof payload.conversation !== "string" || typeof payload.source_site !== "string")
        return send(400, { error: "user_id, conversation and source_site are required" });
      const memory: FixtureMemory = {
        id: randomUUID(), user_id: payload.user_id, content: payload.conversation, source_site: payload.source_site,
        metadata: (payload.metadata as Record<string, unknown>) || {}, created_at: new Date().toISOString(),
      };
      memories.unshift(memory);
      return send(200, { episode_id: randomUUID(), facts_extracted: 0, memories_stored: 1, memories_updated: 0, memories_deleted: 0, memories_skipped: 0, stored_memory_ids: [memory.id], updated_memory_ids: [], links_created: 0, composites_created: 0 });
    }
    if (request.method === "POST" && url.pathname === "/v1/memories/search/fast") {
      if (typeof payload.user_id !== "string" || typeof payload.query !== "string") return send(400, { error: "user_id and query are required" });
      const found = memories.filter(m => m.user_id === payload.user_id && (!payload.source_site || m.source_site === payload.source_site))
        .slice(0, Number(payload.limit) || 10)
        .map(({ id, content, created_at, metadata, source_site }) => ({ id, content, created_at, metadata, source_site }));
      return send(200, { count: found.length, memories: found, injection_text: "", citations: [] });
    }
    const match = url.pathname.match(/^\/v1\/memories\/([0-9a-f-]{36})$/);
    if (request.method === "DELETE" && match) {
      const index = memories.findIndex(m => m.id === match[1] && m.user_id === url.searchParams.get("user_id"));
      if (index < 0) return send(404, { error: "Memory not found" });
      memories.splice(index, 1);
      return send(200, { success: true });
    }
    send(404, { error: "not found" });
  });
  await new Promise<void>(resolve => server.listen(port, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    memories, requests,
    setMode(next: FixtureMode) { mode = next; },
    close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}
