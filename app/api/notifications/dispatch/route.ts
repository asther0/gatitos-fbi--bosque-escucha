import { requireOperator } from "@/lib/auth";
import { database } from "@/lib/supabase";
import { check, failure } from "@/lib/data";
import { dispatchNotification } from "@/lib/notifications";

export async function POST(request: Request) {
  const denied = requireOperator(request);
  if (denied) return denied;
  try {
    const pending = await database()
      .from("be_notifications")
      .select("id")
      .eq("channel", "n8n")
      .in("status", ["queued", "failed", "blocked"])
      .lt("attempts", 5)
      .lte("next_attempt_at", new Date().toISOString())
      .limit(10);
    check(pending.error);
    const results = [];
    for (const item of pending.data || [])
      results.push({ id: item.id, ...(await dispatchNotification(item.id)) });
    return Response.json({ results });
  } catch (error) {
    return failure(error);
  }
}
