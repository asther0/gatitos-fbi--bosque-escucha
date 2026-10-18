"use client";
import { useState } from "react";
import type { Incident } from "@/lib/types";
type Result = { summary: string; recommended_action: string; limitations: string[]; sources: {title: string; url: string}[]; model?: string };
export function IncidentAssistant({ incident, authenticated }: { incident: Incident; authenticated: boolean }) {
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function consult() {
    setError("");
    if (!authenticated) {
      setResult({ summary: incident.summary, recommended_action: "Revisar audio e imagen, contrastar el contexto del sector y registrar una decisión humana antes de notificar.", limitations: ["Ejemplo determinista con datos sintéticos. No se consultó un LLM ni n8n.", "Los indicios no confirman tala ilegal ni identidad."], sources: [] });
      return;
    }
    setBusy(true); setResult(null);
    try {
      const response = await fetch("/api/assistant", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({incident_id: incident.id}) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo completar el análisis.");
      setResult(body);
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo conectar con el asistente."); }
    finally { setBusy(false); }
  }
  return <section className="reason-box" aria-label="Asistente de incidente">
    <h3>Asistente de incidente</h3>
    <p>{authenticated ? "Obtén una recomendación basada en los metadatos del incidente. La decisión sigue siendo del operador." : "Prueba una recomendación de ejemplo para este escenario DEMO."}</p>
    <button className="button" disabled={busy} onClick={() => void consult()}>{busy ? "Consultando asistente…" : "Consultar asistente"}</button>
    <div aria-live="polite">
      {error && <p role="alert">{error}</p>}
      {result && <>
        <p><strong>{authenticated ? "Análisis asistido" : "DEMO · Ejemplo sin IA"}</strong>{result.model ? ` · ${result.model}` : ""}</p>
        <p>{result.summary}</p><strong>Acción sugerida</strong><p>{result.recommended_action}</p>
        {result.limitations.length > 0 && <><strong>Limitaciones</strong><ul>{result.limitations.map((text, i) => <li key={i}>{text}</li>)}</ul></>}
        {result.sources.length > 0 && <><strong>Fuentes consultadas</strong><ul>{result.sources.map((source, i) => <li key={i}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a></li>)}</ul></>}
        <small>No cambia la prioridad, el estado ni envía notificaciones.</small>
      </>}
    </div>
  </section>;
}
