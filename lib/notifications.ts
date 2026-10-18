import "server-only";
import { database } from "./supabase";
import { check } from "./data";

export async function dispatchNotification(id: string) {
  if (!process.env.N8N_WEBHOOK_URL)
    return {
      accepted: false,
      message: "Cola guardada. Falta configurar N8N_WEBHOOK_URL.",
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
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Webhook respondió ${response.status}`);
    return {
      accepted: true,
      message:
        "Webhook aceptó la solicitud; entrega pendiente de confirmación del proveedor.",
    };
  } catch (error) {
    const result = await db
      .from("be_notifications")
      .update({
        status: "failed",
        last_error: error instanceof Error ? error.message : "Fallo webhook",
      })
      .eq("id", id);
    check(result.error);
    return {
      accepted: false,
      message:
        "Entrega no confirmada. Reintento persistido para dentro de 5 minutos.",
    };
  }
}
