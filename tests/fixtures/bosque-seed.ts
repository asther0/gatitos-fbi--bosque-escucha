// FIXTURE ONLY: synthetic sensors and incidents, clearly labelled in the UI.
import type { Tables } from "./supabase-fixture";

export const NODE_A = "FIXTURE-ESP32-A";
export const NODE_B = "FIXTURE-ESP32-B";
export const INCIDENT_A1 = "a1c0ffee-0d3a-4c51-9a55-1a2b3c4d5e01";
export const INCIDENT_A2 = "a2c0ffee-0d3a-4c51-9a55-1a2b3c4d5e02";
export const INCIDENT_B1 = "b1c0ffee-0d3a-4c51-9a55-1a2b3c4d5e03";

export function bosqueSeed(now = Date.now()): Tables {
  const at = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
  const node = (id: string, name: string, sector: string) => ({ id, name, sector, latitude: null, longitude: null, status: "online", battery_pct: null, last_seen: at(0), created_at: at(600) });
  const event = (id: string, node_id: string, minutes: number) => ({
    id, node_id, event_type: "chainsaw", confidence: 0.83, detected_at: at(minutes), received_at: at(minutes), source: "local_center",
    persistent: true, evidence_path: null, evidence_type: null, metadata: { fixture: true },
  });
  const incident = (id: string, node_id: string, event_id: string, minutes: number, status: string) => ({
    id, node_id, title: "FIXTURE · Sonido compatible con motosierra", priority: "medium", status,
    summary: "FIXTURE de demostración: indicio acústico persistente sintético. Requiere revisión humana.",
    event_ids: [event_id], assigned_to: null, review_note: status === "discarded" ? "FIXTURE · Era el generador del campamento." : null,
    created_at: at(minutes), updated_at: at(minutes),
  });
  return {
    be_nodes: [node(NODE_A, "FIXTURE · Sensor ESP32 A", "Sector fixture norte"), node(NODE_B, "FIXTURE · Sensor ESP32 B", "Sector fixture sur")],
    be_events: [event("6f0c4f5e-0d3a-4c51-9a55-0000000000e1", NODE_A, 180), event("6f0c4f5e-0d3a-4c51-9a55-0000000000e2", NODE_A, 5), event("6f0c4f5e-0d3a-4c51-9a55-0000000000e3", NODE_B, 8)],
    be_incidents: [
      incident(INCIDENT_A2, NODE_A, "6f0c4f5e-0d3a-4c51-9a55-0000000000e2", 5, "pending_review"),
      incident(INCIDENT_B1, NODE_B, "6f0c4f5e-0d3a-4c51-9a55-0000000000e3", 8, "pending_review"),
      incident(INCIDENT_A1, NODE_A, "6f0c4f5e-0d3a-4c51-9a55-0000000000e1", 180, "discarded"),
    ],
    be_notifications: [], be_audit: [],
  };
}
