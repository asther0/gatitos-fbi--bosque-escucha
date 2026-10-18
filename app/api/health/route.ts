import { database, configured } from "@/lib/supabase";
export const dynamic = "force-dynamic";
export async function GET() {
  if (!configured())
    return Response.json(
      { status: "unconfigured", database: false },
      { status: 503 },
    );
  try {
    const { error } = await database()
      .from("be_nodes")
      .select("id", { head: true, count: "exact" });
    return Response.json(
      { status: error ? "degraded" : "ok", database: !error },
      { status: error ? 503 : 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "degraded", database: false },
      { status: 503 },
    );
  }
}
