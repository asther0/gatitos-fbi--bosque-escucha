export const statuses: Record<string, string> = {
  pending_review: "Por revisar",
  verified: "Verificado",
  assigned: "Asignado",
  closed: "Cerrado",
  discarded: "Descartado",
  online: "En línea",
  offline: "Sin conexión",
  maintenance: "Mantenimiento",
  queued: "En cola",
  delivered: "Entregado",
  blocked: "Bloqueado",
  sent: "Enviado",
  failed: "Fallido",
};
export const types: Record<string, string> = {
  chainsaw: "Motosierra",
  person: "Persona visible",
  footsteps: "Pasos probables",
  ambient: "Sonido ambiente",
};
export const priorities: Record<string, string> = {
  high: "Alta",
  medium: "Media",
  observation: "Observación",
};
export const time = (value?: string | null) =>
  value
    ? new Date(value).toLocaleTimeString("es-PE", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone: "America/Lima",
      })
    : "Sin registro";
export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
