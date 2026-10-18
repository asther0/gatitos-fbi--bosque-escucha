import type { DashboardData, ForestEvent } from "./types";

/** Synthetic, browser-only walkthrough. Never sent to the operational API. */
export function publicDemo(scenario = "combined"): DashboardData {
  const now = new Date().toISOString();
  const events: ForestEvent[] = (scenario === "combined" ? ["chainsaw", "person"] : [scenario === "chainsaw" ? "chainsaw" : "ambient"]).map((event_type, index) => ({
    id: `demo-event-${index}`, node_id: "DEMO-01", event_type: event_type as ForestEvent["event_type"],
    confidence: event_type === "person" ? 0.86 : 0.91, detected_at: now, received_at: now,
    source: "demo", persistent: event_type === "chainsaw", evidence_path: null, evidence_type: null,
    metadata: { synthetic: true },
  }));
  return {
    configured: true, authenticated: false, mode: "demo",
    nodes: [{ id: "DEMO-01", name: "Nodo de demostración", sector: "Sector A · Ubicación simulada", latitude: -12.836, longitude: -69.286, status: "online", battery_pct: 87, last_seen: now, created_at: now }],
    events,
    incidents: scenario === "ambient" ? [] : [{ id: "demo-incident", node_id: "DEMO-01", title: scenario === "combined" ? "Motosierra persistente + persona" : "Motosierra persistente", priority: scenario === "combined" ? "high" : "medium", status: "pending_review", summary: scenario === "combined" ? "Escenario simulado: audio persistente y presencia de una persona en el mismo nodo dentro de 120 segundos. Se prioriza para revisión humana." : "Escenario simulado: indicio acústico persistente. Requiere revisión humana antes de actuar.", event_ids: events.map(e => e.id), assigned_to: null, review_note: null, created_at: now, updated_at: now }],
    audit: [], notifications: [],
  };
}
