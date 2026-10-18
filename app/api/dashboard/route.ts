import { isOperator } from "@/lib/auth";
import { database, configured } from "@/lib/supabase";
import { check } from "@/lib/data";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const empty = {
    nodes: [],
    events: [],
    incidents: [],
    notifications: [],
    audit: [],
    configured: configured(),
  };
  if (!configured())
    return Response.json(empty, { headers: { "Cache-Control": "no-store" } });
  try {
    const db = database();
    const operator = isOperator(request);
    const queries = ["be_nodes", "be_events", "be_incidents"].map((table) => {
      let q = db.from(table).select("*");
      if (!operator)
        q = q.eq(table === "be_nodes" ? "id" : "node_id", "DEMO-01");
      return q
        .order(table === "be_events" ? "detected_at" : "created_at", {
          ascending: false,
        })
        .limit(200);
    });
    const results = await Promise.all(queries);
    results.forEach((r) => check(r.error));
    const [rawNodes, events, incidents] = results.map((r) => r.data || []);
    const nodes = rawNodes.map((n) => ({
      ...n,
      status:
        n.status === "online" &&
        (!n.last_seen || Date.now() - Date.parse(n.last_seen) > 120000)
          ? "offline"
          : n.status,
    }));
    const ids = incidents.map((i) => i.id);
    const extra = ids.length
      ? await Promise.all(
          ["be_notifications", "be_audit"].map((t) =>
            db
              .from(t)
              .select("*")
              .in("incident_id", ids)
              .order("created_at", { ascending: false })
              .limit(200),
          ),
        )
      : [];
    extra.forEach((r) => check(r.error));
    return Response.json(
      {
        nodes,
        events: operator
          ? events
          : events.map((e) => ({
              ...e,
              evidence_path: null,
              metadata: { simulated: true },
            })),
        incidents: operator
          ? incidents
          : incidents.map((i) => ({
              ...i,
              review_note: null,
              assigned_to: null,
            })),
        notifications: operator
          ? extra[0]?.data || []
          : (extra[0]?.data || []).map((n) => ({
              id: n.id,
              incident_id: n.incident_id,
              channel: n.channel,
              status: n.status,
              created_at: n.created_at,
              sent_at: n.sent_at,
              approved_by: "operador demo",
              last_error: null,
            })),
        audit: operator ? extra[1]?.data || [] : [],
        configured: true,
        demo_only: !operator,
        mode: operator ? "live" : "demo",
        authenticated: operator,
        updated_at: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return Response.json(
      {
        ...empty,
        error: "No se pudo consultar la base de datos",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
