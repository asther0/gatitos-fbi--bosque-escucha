import { z } from "zod";
import { requireOperator } from "@/lib/auth";
import { database } from "@/lib/supabase";
import { readJson } from "@/lib/payload";
import {
  contextNote, deleteNodeContext, memoryConfig, MemoryUnavailable, saveNodeContext, searchNodeContext,
} from "@/lib/atomic-memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: noStore });

type Context = { params: Promise<{ id: string }> };
const incidentSchema = z.object({ id: z.string(), node_id: z.string(), title: z.string(), summary: z.string() });
type Incident = z.infer<typeof incidentSchema>;

// The sensor comes from the stored incident; the browser only names the incident.
async function loadIncident(context: Context): Promise<Incident | Response> {
  const parsed = z.string().uuid().safeParse((await context.params).id);
  if (!parsed.success) return json({ error: "Identificador de incidente inválido." }, 400);
  try {
    const { data, error } = await database().from("be_incidents").select("id,node_id,title,summary").eq("id", parsed.data).maybeSingle();
    if (error) throw error;
    return data ? incidentSchema.parse(data) : json({ error: "Incidente no encontrado." }, 404);
  } catch {
    return json({ error: "No se pudo consultar el incidente." }, 503);
  }
}

function unavailable(error: unknown, saved: boolean) {
  const message = error instanceof MemoryUnavailable ? error.message : "No se pudo completar la operación con Atomic Memory.";
  return json({ enabled: true, saved, error: message }, 502);
}

export async function GET(request: Request, context: Context) {
  const denied = requireOperator(request);
  if (denied) return denied;
  const config = memoryConfig();
  if (!config) return json({ enabled: false, items: [] });
  const incident = await loadIncident(context);
  if (incident instanceof Response) return incident;
  try {
    const items = await searchNodeContext(config, { nodeId: incident.node_id, query: `${incident.title}. ${incident.summary}` });
    return json({ enabled: true, node_id: incident.node_id, items });
  } catch (error) {
    return unavailable(error, false);
  }
}

export async function POST(request: Request, context: Context) {
  const denied = requireOperator(request);
  if (denied) return denied;
  const config = memoryConfig();
  if (!config) return json({ enabled: false, saved: false, error: "La memoria de contexto no está configurada; no se guardó nada." }, 503);
  let body: { note: string; replaces?: string };
  try {
    body = z.object({ note: contextNote, replaces: z.string().uuid().optional() }).parse(await readJson(request, 4096));
  } catch {
    return json({ saved: false, error: "Escribe un contexto de 3 a 500 caracteres." }, 400);
  }
  const incident = await loadIncident(context);
  if (incident instanceof Response) return incident;
  let id: string;
  try {
    id = await saveNodeContext(config, { nodeId: incident.node_id, incidentId: incident.id, note: body.note });
  } catch (error) {
    return unavailable(error, false);
  }
  if (!body.replaces) return json({ enabled: true, saved: true, id }, 201);
  // A correction is a new record plus removal of the old one; report each step.
  try {
    const removed = await deleteNodeContext(config, { nodeId: incident.node_id, memoryId: body.replaces });
    return json({ enabled: true, saved: true, id, replaced: removed }, 201);
  } catch {
    return json({ enabled: true, saved: true, id, replaced: false }, 201);
  }
}

export async function DELETE(request: Request, context: Context) {
  const denied = requireOperator(request);
  if (denied) return denied;
  const config = memoryConfig();
  if (!config) return json({ enabled: false, deleted: false, error: "La memoria de contexto no está configurada." }, 503);
  let memoryId: string;
  try {
    memoryId = z.object({ memory_id: z.string().uuid() }).parse(await readJson(request, 1024)).memory_id;
  } catch {
    return json({ deleted: false, error: "Identificador de contexto inválido." }, 400);
  }
  const incident = await loadIncident(context);
  if (incident instanceof Response) return incident;
  try {
    const deleted = await deleteNodeContext(config, { nodeId: incident.node_id, memoryId });
    return deleted ? json({ enabled: true, deleted: true }) : json({ enabled: true, deleted: false, error: "Ese contexto no existe para este sensor." }, 404);
  } catch (error) {
    return json({ enabled: true, deleted: false, error: error instanceof MemoryUnavailable ? error.message : "No se pudo eliminar." }, 502);
  }
}
