export type Signal = {
  id: string;
  node_id: string;
  event_type: string;
  persistent: boolean;
  detected_at: string;
  source: string;
};
export function triage(current: Signal, previous: Signal[]) {
  if (current.event_type === "ambient") return null;
  const signals = [...previous, current]
    .filter((e, i, a) => a.findIndex((x) => x.id === e.id) === i)
    .filter(
      (e) =>
        e.node_id === current.node_id &&
        (e.source === "demo") === (current.source === "demo") &&
        Math.abs(Date.parse(e.detected_at) - Date.parse(current.detected_at)) <=
          120000,
    );
  const saw = signals.some((e) => e.event_type === "chainsaw" && e.persistent);
  const person = signals.some((e) => e.event_type === "person");
  const priority = saw && person ? "high" : saw ? "medium" : "observation";
  return {
    priority,
    title:
      priority === "high"
        ? "Motosierra persistente y presencia humana"
        : priority === "medium"
          ? "Sonido persistente de motosierra"
          : "Actividad por revisar",
    summary:
      priority === "high"
        ? "Señales coincidentes en una ventana de 120 segundos. Requiere revisión humana."
        : priority === "medium"
          ? "Se reportó una señal persistente compatible con motosierra. Revisar evidencia."
          : "Señal aislada. Revisar contexto y evidencia.",
    event_ids: signals
      .filter((e) => e.event_type !== "ambient")
      .map((e) => e.id),
  };
}
