import { time } from "./dashboard-ui";
export function NotificationReceipt({
  notification,
}: {
  notification: {
    delivered_at?: string | null;
    acknowledged_at?: string | null;
    acknowledged_by?: string | null;
  };
}) {
  return (
    <>
      {notification.delivered_at && (
        <p>Entregado por proveedor: {time(notification.delivered_at)} PET</p>
      )}
      {notification.acknowledged_at ? (
        <p className="human-receipt">
          Confirmación humana:{" "}
          {notification.acknowledged_by || "Contacto territorial"} ·{" "}
          {time(notification.acknowledged_at)} PET
        </p>
      ) : (
        <p>Sin confirmación humana registrada</p>
      )}
    </>
  );
}
