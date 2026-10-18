import { AudioLines, Eye, Headphones, Lock } from "lucide-react";
import type { ForestEvent } from "@/lib/types";
import { Badge, time, types } from "./dashboard-ui";
export function EventTable({ events }: { events: ForestEvent[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Señal detectada</th>
            <th>Nodo</th>
            <th>Score del modelo</th>
            <th>Origen</th>
            <th>Hora · PET</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td>
                <span className="event-type">
                  {e.event_type === "person" ? (
                    <Eye size={16} />
                  ) : (
                    <AudioLines size={16} />
                  )}{" "}
                  {types[e.event_type] || e.event_type}
                </span>
              </td>
              <td className="mono">{e.node_id}</td>
              <td>
                <div className="score">
                  <span>
                    <i
                      style={{
                        width: `${Math.max(0, Math.min(100, e.confidence * 100))}%`,
                      }}
                    />
                  </span>
                  {(e.confidence * 100).toFixed(0)}%
                </div>
              </td>
              <td>
                <Badge tone={e.source === "demo" ? "amber" : "neutral"}>
                  {e.source === "demo"
                    ? "DEMO"
                    : e.source === "local_center"
                      ? "Centro local"
                      : e.source === "device"
                        ? "Dispositivo"
                        : e.source}
                </Badge>
              </td>
              <td className="mono muted">{time(e.detected_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!events.length && (
        <div className="empty">Esperando eventos del centro.</div>
      )}
    </div>
  );
}
export function Evidence({
  event,
  authenticated,
}: {
  event: ForestEvent;
  authenticated: boolean;
}) {
  const url = event.evidence_path
    ? `/api/evidence?path=${encodeURIComponent(event.evidence_path)}`
    : "";
  return (
    <article className="evidence-card">
      <div className="evidence-title">
        <strong>{types[event.event_type] || event.event_type}</strong>
        <span className="mono tiny">
          Score {(event.confidence * 100).toFixed(0)}%
        </span>
      </div>
      <p className="tiny muted">
        {event.node_id} · {time(event.detected_at)}{" "}
        {event.source === "demo" ? "· DEMO" : ""}
        {event.persistent ? " · Persistente" : ""}
      </p>
      {url && authenticated ? (
        event.evidence_type === "image" ? (
          <a href={url} target="_blank" rel="noreferrer">
            <img
              src={url}
              alt={`Evidencia de ${types[event.event_type] || event.event_type} del nodo ${event.node_id}`}
            />
          </a>
        ) : (
          <audio controls preload="none" src={url} />
        )
      ) : (
        <div className="evidence-placeholder">
          {url ? <Lock size={20} /> : <Headphones size={20} />}
          <span>
            {url
              ? "Evidencia restringida a operadores"
              : "Sin archivo de evidencia adjunto"}
          </span>
        </div>
      )}
      <small className="tiny muted">
        El score es una salida del modelo, no una probabilidad calibrada.
      </small>
    </article>
  );
}
