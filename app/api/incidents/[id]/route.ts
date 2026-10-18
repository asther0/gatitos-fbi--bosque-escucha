import { requireOperator } from "@/lib/auth";
import { database } from "@/lib/supabase";
import { check, failure } from "@/lib/data";
import { z } from "zod";
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const denied = requireOperator(request);
  if (denied) return denied;
  try {
    const { id } = await context.params;
    z.string().uuid().parse(id);
    const body = z
      .object({
        status: z
          .enum(["discarded", "verified", "assigned", "closed"])
          .optional(),
        priority: z.enum(["high", "medium", "observation"]).optional(),
        review_note: z.string().max(2000).optional(),
        assigned_to: z.string().max(120).optional(),
      })
      .parse(await request.json());
    if (body.priority) {
      if (body.status)
        return Response.json(
          { error: "Cambia prioridad y estado por separado" },
          { status: 400 },
        );
      const result = await database().rpc("be_change_priority", {
        target: id,
        new_priority: body.priority,
        reason: body.review_note || "",
      });
      check(result.error);
      return Response.json({ incident: result.data });
    }
    if (!body.status)
      return Response.json(
        { error: "Estado o prioridad requerido" },
        { status: 400 },
      );
    const { data, error } = await database().rpc("be_review_incident", {
      target: id,
      next_status: body.status,
      note: body.review_note || null,
      assignee: body.assigned_to || null,
    });
    check(error);
    return Response.json({ incident: data });
  } catch (e) {
    return failure(e, 400);
  }
}
