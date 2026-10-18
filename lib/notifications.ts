import "server-only";
import { database } from "./supabase";
import { check } from "./data";

export async function dispatchNotification(id: string) {
  if (!process.env.N8N_WEBHOOK_URL || !process.env.N8N_WEBHOOK_SECRET)
    return {
      accepted: false,
      message: "Cola guardada. Falta configurar webhook n8n y autenticación.",
    };
  const db = database();
  const claim = await db.rpc("be_claim_notification", { target: id });
  check(claim.error);
  if (!claim.data)
    return {
      accepted: false,
      message:
        "Sin envío: demo, destinatario pendiente, envío finalizado o espera de reintento.",
    };
  const { notification, incident, contact } = claim.data;
  try {
    const response = await fetch(process.env.N8N_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": notification.id,
        ...(process.env.N8N_WEBHOOK_SECRET
          ? { Authorization: `Bearer ${process.env.N8N_WEBHOOK_SECRET}` }
          : {}),
      },
      body: JSON.stringify({ notification, incident, contact }),
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) throw new Error(`Webhook respondió ${response.status}`);
    const receipt = await response.json();
    if (receipt.accepted !== true) return { accepted: false, message: `Proveedor pendiente: ${receipt.status || "sin confirmación"}. Revisar ejecución n8n.` };
    return {
      accepted: true,
      message:
        "Webhook aceptó la solicitud; entrega pendiente de confirmación del proveedor.",
    };
  } catch (error) {
    const result = await db
      .from("be_notifications")
      .update({
        // A webhook timeout does not prove provider delivery failed. Keep the
        // pending state so a later signed sent/delivered receipt can advance it.
        last_error: error instanceof Error ? error.message : "Fallo webhook",
      })
      .eq("id", id)
      .in("status", ["queued", "blocked", "failed"]);
    check(result.error);
    return {
      accepted: false,
      message:
        "Entrega no confirmada. Revisa n8n y Kapso antes de reintentar; una reserva existente impide duplicar el envío.",
    };
  }
}
