import { isCenterAuthorized } from "@/lib/auth";
import { database } from "@/lib/supabase";
import { check, failure } from "@/lib/data";
import { z } from "zod";
const uuid = z.string().uuid(),
  dt = z
    .string()
    .datetime()
    .refine(
      (value) => Date.parse(value) <= Date.now() + 60_000,
      "Fecha futura no permitida",
    );
const node = z.object({
  id: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .refine((x) => x !== "DEMO-01"),
  name: z.string().max(200),
  sector: z.string().max(200),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  status: z.enum(["online", "offline", "maintenance"]),
  battery_pct: z.number().min(0).max(100).nullable(),
  last_seen: dt.nullable(),
  created_at: dt,
});
const event = z.object({
  id: uuid,
  node_id: z.string().refine((x) => x !== "DEMO-01"),
  event_type: z.enum(["chainsaw", "person", "footsteps", "ambient"]),
  confidence: z.number().min(0).max(1),
  detected_at: dt,
  received_at: dt,
  source: z
    .enum(["device", "manual", "local_center"])
    .transform(() => "local_center"),
  persistent: z.boolean(),
  evidence_path: z.string().nullable().optional(),
  evidence_type: z.enum(["image", "audio"]).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
const incident = z.object({
  id: uuid,
  node_id: z.string().refine((x) => x !== "DEMO-01"),
  title: z.string().max(300),
  priority: z.enum(["high", "medium", "observation"]),
  status: z.enum([
    "pending_review",
    "discarded",
    "verified",
    "assigned",
    "closed",
  ]),
  summary: z.string().max(5000),
  event_ids: z.array(uuid).max(1000),
  assigned_to: z.string().nullable(),
  review_note: z.string().nullable(),
  created_at: dt,
  updated_at: dt,
});
const audit = z.object({
  id: uuid,
  incident_id: uuid,
  action: z.string().max(200),
  actor: z.string().max(200),
  details: z.record(z.string(), z.unknown()),
  created_at: dt,
});
const notification = z.object({
  id: uuid,
  incident_id: uuid,
  channel: z.string().max(100),
  status: z.enum(["queued", "sent", "delivered", "failed", "blocked"]),
  approved_by: z.string().max(200),
  created_at: dt,
  sent_at: dt.nullable(),
  last_error: z.string().nullable(),
  delivered_at: dt.nullable().optional(),
  acknowledged_at: dt.nullable().optional(),
  acknowledged_by: z.string().nullable().optional(),
  attempts: z.number().int().min(0).default(0),
  next_attempt_at: dt.nullable().optional(),
  provider_id: z.string().nullable().optional(),
  destination: z.string().nullable().optional(),
});
const snapshot = z.object({
  nodes: z.array(node).max(100),
  events: z.array(event).max(1000),
  incidents: z.array(incident).max(1000),
  audit: z.array(audit).max(2000),
  notifications: z.array(notification).max(1000),
});
export async function POST(request: Request) {
  if (!isCenterAuthorized(request))
    return Response.json({ error: "No autorizado" }, { status: 401 });
  try {
    const data = snapshot.parse(await request.json());
    for (const event of data.events) {
      if (
        event.evidence_path &&
        (!event.evidence_path.startsWith(event.node_id + "/") ||
          !/^[A-Za-z0-9_-]+\/[a-f0-9-]+\.(jpg|png|wav)$/.test(
            event.evidence_path,
          ))
      )
        return Response.json(
          { error: "Ruta de evidencia inválida" },
          { status: 400 },
        );
      if (Boolean(event.evidence_path) !== Boolean(event.evidence_type))
        return Response.json(
          { error: "Indica ruta y tipo de evidencia juntos" },
          { status: 400 },
        );
    }
    const { data: result, error } = await database().rpc("be_sync_snapshot", {
      payload: data,
    });
    check(error);
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return failure(e, 400);
  }
}
