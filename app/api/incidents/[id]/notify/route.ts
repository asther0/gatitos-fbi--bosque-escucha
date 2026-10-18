import { readJson } from "@/lib/payload";
import { requireOperator } from "@/lib/auth";
import { database } from "@/lib/supabase";
import { check, failure } from "@/lib/data";
import { dispatchNotification } from "@/lib/notifications";
import { z } from "zod";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const denied = requireOperator(request);
  if (denied) return denied;
  try {
    const { id } = await context.params;
    z.string().uuid().parse(id);
    z.object({ approved: z.literal(true) }).parse(await readJson(request));
    const db = database();
    const queued = await db.rpc("be_queue_notification", { target: id });
    check(queued.error);
    const result = await dispatchNotification(queued.data.notification.id);
    const updated = await db
      .from("be_notifications")
      .select("*")
      .eq("id", queued.data.notification.id)
      .single();
    check(updated.error);
    return Response.json(
      { notification: updated.data, ...result },
      { status: 202 },
    );
  } catch (error) {
    return failure(error, 400);
  }
}
