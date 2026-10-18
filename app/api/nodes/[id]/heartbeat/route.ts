import { readJson } from "@/lib/payload";
import { isDeviceAuthorized, isCenterAuthorized } from "@/lib/auth";
import { database } from "@/lib/supabase";
import { check, failure } from "@/lib/data";
import { z } from "zod";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!isDeviceAuthorized(request) && !isCenterAuthorized(request))
    return Response.json({ error: "No autorizado" }, { status: 401 });
  try {
    const { id } = await context.params;
    const body = z
      .object({
        battery_pct: z.number().min(0).max(100).nullable().optional(),
        status: z.enum(["online", "offline", "maintenance"]).default("online"),
      })
      .parse(await readJson(request));
    const { data, error } = await database()
      .from("be_nodes")
      .update({ ...body, last_seen: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    check(error);
    return Response.json({ node: data });
  } catch (error) {
    return failure(error, 400);
  }
}
