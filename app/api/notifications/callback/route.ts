import { createHash, timingSafeEqual } from "node:crypto";
import { database } from "@/lib/supabase";
import { check, failure } from "@/lib/data";
import { z } from "zod";

export async function POST(request: Request) {
  const secret = process.env.NOTIFICATION_CALLBACK_SECRET;
  const provided = request.headers.get("authorization") || "";
  if (
    !secret ||
    !timingSafeEqual(
      createHash("sha256").update(provided).digest(),
      createHash("sha256").update(`Bearer ${secret}`).digest(),
    )
  )
    return Response.json({ error: "No autorizado" }, { status: 401 });
  try {
    const body = z
      .object({
        notification_id: z.string().uuid(),
        status: z.enum(["sent", "delivered", "failed", "acknowledged"]),
        provider_id: z.string().max(300).optional(),
        actor: z.string().max(200).optional(),
      })
      .parse(await request.json());
    if (
      (body.status === "sent" || body.status === "delivered") &&
      !body.provider_id
    )
      return Response.json(
        { error: "Se requiere ID real del proveedor" },
        { status: 400 },
      );
    const { data, error } = await database().rpc("be_notification_callback", {
      target: body.notification_id,
      delivery_status: body.status,
      provider_reference: body.provider_id || null,
      human_actor: body.actor || null,
    });
    check(error);
    return Response.json({ notification: data });
  } catch (error) {
    return failure(error, 400);
  }
}
