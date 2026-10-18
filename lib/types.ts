export type Priority = "high" | "medium" | "observation";
export type IncidentStatus = "pending_review" | "discarded" | "verified" | "assigned" | "closed";
export type EventType = "chainsaw" | "person" | "footsteps" | "ambient";
export type EventSource = "device" | "manual" | "demo" | "local_center";
export interface ForestNode {
  id: string; name: string; sector: string; latitude: number | null; longitude: number | null;
  status: "online" | "offline" | "maintenance"; battery_pct: number | null;
  last_seen: string | null; created_at: string;
}
export interface ForestEvent {
  id: string; node_id: string; event_type: EventType; confidence: number;
  detected_at: string; received_at: string; source: EventSource; persistent: boolean;
  evidence_path: string | null; evidence_type: "image" | "audio" | null;
  metadata: Record<string, unknown>;
}
export interface Incident {
  id: string; node_id: string; title: string; priority: Priority; status: IncidentStatus;
  summary: string; event_ids: string[]; assigned_to: string | null; review_note: string | null;
  created_at: string; updated_at: string;
}
export interface AuditEntry {
  id: string; incident_id: string | null; action: string; actor: string;
  details: Record<string, unknown>; created_at: string;
}
export interface Notification {
  id: string; incident_id: string; channel: string; status: "queued" | "sent" | "delivered" | "failed" | "blocked";
  approved_by: string; created_at: string; sent_at: string | null; last_error: string | null;
  delivered_at?: string | null; acknowledged_at?: string | null; acknowledged_by?: string | null;
  attempts?: number; next_attempt_at?: string | null; provider_id?: string | null;
  destination?: string | null; contact_id?: string | null;
}
export interface DashboardData {
  nodes: ForestNode[]; events: ForestEvent[]; incidents: Incident[];
  notifications: Notification[]; audit: AuditEntry[]; configured: boolean; error?: string;
  mode?: "demo" | "live"; authenticated?: boolean; updated_at?: string;
}
