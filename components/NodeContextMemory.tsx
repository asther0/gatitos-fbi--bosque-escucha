"use client";
import { useCallback, useEffect, useState } from "react";
import type { Incident } from "@/lib/types";
type Item = { id: string; content: string; saved_at: string | null; incident_id: string | null };
type State =
  | { kind: "loading" }
  | { kind: "disabled" }
  | { kind: "error"; message: string }
  | { kind: "ready"; items: Item[] };
const date = (value: string | null) => value
  ? new Date(value).toLocaleString("es-PE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Lima" })
  : "Fecha no disponible";

/** Reviewed context about the incident's sensor, saved only on explicit operator action. */
export function NodeContextMemory({ incident, sensor }: { incident: Incident; sensor: string }) {
  const url = `/api/incidents/${incident.id}/context`;
  const [state, setState] = useState<State>({ kind: "loading" });
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await fetch(url, { cache: "no-store" });
      const body = await response.json();
      if (body.enabled === false) return setState({ kind: "disabled" });
      if (!response.ok) throw new Error(body.error || "No se pudo consultar el contexto guardado.");
      setState({ kind: "ready", items: body.items });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : "No se pudo consultar el contexto guardado." });
    }
  }, [url]);
  useEffect(() => { void load(); }, [load]);
  async function send(method: "POST" | "DELETE", payload: Record<string, string>) {
    setBusy(true); setFeedback("");
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      return { ok: response.ok, body: await response.json() };
    } catch {
      return { ok: false, body: { error: "Sin conexión con el centro." } };
    } finally { setBusy(false); }
  }
  async function save() {
    const { body } = await send("POST", editing ? { note: draft, replaces: editing.id } : { note: draft });
    if (body.saved !== true) return setFeedback(`No se guardó. ${body.error || ""}`.trim());
    setFeedback(!editing ? "Contexto guardado en Atomic Memory." : body.replaced ? "Contexto corregido: se reemplazó la versión anterior."
      : "Se guardó la corrección, pero la versión anterior no se pudo eliminar. Elimínala manualmente.");
    setDraft(""); setEditing(null);
    await load();
  }
  async function remove(item: Item) {
    const { body } = await send("DELETE", { memory_id: item.id });
    setFeedback(body.deleted === true ? "Contexto eliminado." : `No se eliminó. ${body.error || ""}`.trim());
    if (editing?.id === item.id) { setEditing(null); setDraft(""); }
    await load();
  }
  if (state.kind === "disabled") return <p className="tiny muted context-off">Memoria de contexto del sensor no configurada. La revisión funciona igual.</p>;
  return <section className="reason-box context-memory" aria-label="Contexto revisado del sensor">
    <strong>Contexto revisado de {sensor}</strong>
    <p>Notas que el equipo guardó en revisiones anteriores de este sensor. Son referencia: no son evidencia ni cambian prioridad, estado o alertas.</p>
    {state.kind === "loading" && <p aria-live="polite">Buscando contexto guardado…</p>}
    {state.kind === "error" && <p role="alert">{state.message} Revisa la evidencia normalmente.</p>}
    {state.kind === "ready" && (state.items.length ? <ul className="context-list">
      {state.items.map(item => <li key={item.id}>
        <span>{item.content}</span>
        <small>Guardado {date(item.saved_at)} PET{item.incident_id ? ` · incidente ${item.incident_id.slice(0, 8)}` : ""}</small>
        <span className="context-actions">
          <button className="button" disabled={busy} onClick={() => { setEditing(item); setDraft(item.content); setFeedback(""); }}>Corregir</button>
          <button className="button" disabled={busy} onClick={() => void remove(item)}>Eliminar</button>
        </span>
      </li>)}
    </ul> : <p>Aún no hay contexto guardado para este sensor.</p>)}
    {state.kind !== "loading" && <label>
      {editing ? "Corregir contexto guardado" : "Guardar contexto para próximas revisiones"}
      <textarea maxLength={500} value={draft} onChange={e => setDraft(e.target.value)}
        placeholder="Ej.: El generador del campamento suena entre 6:00 y 7:00; confirmar con el guardaparque antes de priorizar." />
    </label>}
    {state.kind !== "loading" && <span className="context-actions">
      <button className="button primary" disabled={busy || draft.trim().length < 3} onClick={() => void save()}>
        {busy ? "Guardando…" : editing ? "Guardar corrección" : "Guardar contexto del sensor"}
      </button>
      {editing && <button className="button" disabled={busy} onClick={() => { setEditing(null); setDraft(""); }}>Cancelar</button>}
    </span>}
    <small>Se guarda solo al pulsar el botón, para este sensor y únicamente en la vista de operador.</small>
    {feedback && <p className="inline-feedback" role="status">{feedback}</p>}
  </section>;
}
