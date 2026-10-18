import "server-only";
import { database } from "./supabase";
import { z } from "zod";
import { metadataSchema, PayloadError } from "./payload";
export const eventSchema = z.object({
  event_id: z.string().uuid().optional(),
  node_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  event_type: z.enum(["chainsaw", "person", "footsteps", "ambient"]),
  confidence: z.number().min(0).max(1),
  persistent: z.boolean().default(false),
  detected_at: z.string().datetime().optional(),
  source: z
    .enum(["device", "manual", "demo", "local_center"])
    .default("device"),
  metadata: metadataSchema.default({}),
  evidence_path: z.string().max(300).nullable().optional(),
  evidence_type: z.enum(["image", "audio"]).nullable().optional(),
});
class DatabaseFailure extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export function failure(error: unknown, status = 500) {
  if (error instanceof z.ZodError || error instanceof SyntaxError) status = 400;
  if (error instanceof DatabaseFailure || error instanceof PayloadError)
    status = error.status;
  return Response.json(
    {
      error:
        error instanceof z.ZodError
          ? "Payload inválido"
          : error instanceof Error
            ? error.message
            : "Error de almacenamiento",
    },
    { status },
  );
}
export function check(error: { message: string; code?: string } | null) {
  if (error)
    throw new DatabaseFailure(
      error.message,
      error.code === "P0001"
        ? 409
        : error.code === "23503" || error.code === "23514"
          ? 400
          : error.code === "PGRST116"
            ? 404
            : 503,
    );
}
export async function ingest(input: z.input<typeof eventSchema>) {
  const value = eventSchema.parse(input);
  const db = database();
  const id = value.event_id || crypto.randomUUID();
  if ((value.node_id === "DEMO-01") !== (value.source === "demo"))
    throw new Error("El nodo DEMO-01 solo acepta eventos demo");
  if (
    value.evidence_path &&
    !value.evidence_path.startsWith(value.node_id + "/")
  )
    throw new Error("La evidencia no corresponde al nodo");
  const now = new Date().toISOString();
  if (value.detected_at && Date.parse(value.detected_at) > Date.now() + 60_000)
    throw new Error("Fecha futura no permitida");
  if (
    value.evidence_path &&
    !/^[A-Za-z0-9_-]+\/[a-f0-9-]+\.(jpg|png|wav)$/.test(value.evidence_path)
  )
    throw new Error("Ruta de evidencia inválida");
  if (Boolean(value.evidence_path) !== Boolean(value.evidence_type))
    throw new Error("Indica ruta y tipo de evidencia juntos");
  const { event_id: _, ...rest } = value;
  const event = {
    ...rest,
    id,
    detected_at: value.detected_at || now,
    received_at: now,
    evidence_path: value.evidence_path ?? null,
    evidence_type: value.evidence_type ?? null,
  };
  const { data: result, error } = await db.rpc("be_ingest_event", {
    payload: event,
  });
  check(error);
  return result as {
    event: typeof event;
    incident: unknown;
    idempotent?: boolean;
  };
}
