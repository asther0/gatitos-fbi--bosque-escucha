"use client";
import { useEffect, useState } from "react";
import { Radio, Users, Send } from "lucide-react";
type Contact = {
  id: string;
  name: string;
  sector: string;
  destination: string;
  channel: string;
  enabled: boolean;
};
export function OperationsSettings({
  authenticated,
  onLogin,
  onRefresh,
}: {
  authenticated: boolean;
  onLogin: () => void;
  onRefresh: () => void;
}) {
  const [contacts, setContacts] = useState<Contact[]>([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const load = async () => {
    const response = await fetch("/api/contacts");
    if (response.ok) {
      const value = await response.json();
      setContacts(Array.isArray(value) ? value : value.contacts || []);
    }
  };
  useEffect(() => {
    if (authenticated) void load();
    else setContacts([]);
  }, [authenticated]);
  async function submit(url: string, body: unknown) {
    if (!authenticated) {
      onLogin();
      return false;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "No se pudo guardar");
      setMessage(result.message || "Operación guardada.");
      await load();
      onRefresh();
      return true;
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "No se pudo conectar",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-grid operational-settings">
      <section className="panel settings-card">
        <h2>
          <Radio size={20} /> Registrar nodo
        </h2>
        <p>
          Registra las coordenadas del árbol. El nodo aparecerá sin conexión
          hasta recibir datos del dispositivo.
        </p>
        <form
          className="settings-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const values = new FormData(form);
            if (
              await submit("/api/nodes", {
                id: values.get("id"),
                name: values.get("name"),
                sector: values.get("sector"),
                latitude: Number(values.get("latitude")),
                longitude: Number(values.get("longitude")),
              })
            )
              form.reset();
          }}
        >
          <div className="form-columns">
            <label>
              ID del nodo
              <input
                required
                name="id"
                pattern="[A-Za-z0-9_-]{1,64}"
                placeholder="BOSQUE-01"
              />
            </label>
            <label>
              Nombre
              <input
                required
                name="name"
                placeholder="Árbol de observación 01"
              />
            </label>
          </div>
          <label>
            Sector
            <input required name="sector" placeholder="Sector norte" />
          </label>
          <div className="form-columns">
            <label>
              Latitud
              <input
                required
                name="latitude"
                type="number"
                min="-90"
                max="90"
                step="any"
                placeholder="-12.84"
              />
            </label>
            <label>
              Longitud
              <input
                required
                name="longitude"
                type="number"
                min="-180"
                max="180"
                step="any"
                placeholder="-69.29"
              />
            </label>
          </div>
          <button disabled={busy} className="button primary">
            Registrar nodo
          </button>
        </form>
      </section>
      <section className="panel settings-card">
        <h2>
          <Users size={20} /> Contacto territorial
        </h2>
        <p>
          Configura el destinatario acordado por sector. La notificación
          requiere aprobación del operador.
        </p>
        <form
          className="settings-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const values = new FormData(form);
            if (
              await submit("/api/contacts", {
                name: values.get("name"),
                sector: values.get("sector"),
                destination: values.get("destination"),
                channel: values.get("channel"),
                enabled: true,
              })
            )
              form.reset();
          }}
        >
          <div className="form-columns">
            <label>
              Responsable
              <input
                required
                name="name"
                placeholder="Nombre del responsable"
              />
            </label>
            <label>
              Sector
              <input required name="sector" placeholder="Sector norte" />
            </label>
          </div>
          <div className="form-columns">
            <label>
              Teléfono internacional
              <input
                required
                name="destination"
                type="tel"
                pattern="\+[1-9][0-9]{7,14}"
                placeholder="+51999999999"
              />
            </label>
            <label>
              Canal
              <select name="channel">
                <option value="whatsapp">WhatsApp</option>
                <option value="sms">SMS</option>
              </select>
            </label>
          </div>
          <button disabled={busy} className="button primary">
            Guardar contacto
          </button>
        </form>
        {contacts.map((contact) => (
          <div className="contact-row" key={contact.id}>
            <div>
              <strong>{contact.name}</strong>
              <p>
                {contact.sector} · {contact.channel} · {contact.destination}
              </p>
            </div>
            <span>{contact.enabled ? "Habilitado" : "Desactivado"}</span>
          </div>
        ))}
      </section>
      <section className="panel settings-card">
        <h2>
          <Send size={20} /> Cola de notificaciones
        </h2>
        <p>
          Procesa los envíos previamente aprobados. Los incidentes DEMO nunca
          envían mensajes externos. El proveedor y los contactos deben estar
          configurados.
        </p>
        <button
          disabled={busy}
          className="button"
          onClick={() => void submit("/api/notifications/dispatch", {})}
        >
          Procesar envíos pendientes
        </button>
      </section>
      {message && (
        <p className="inline-feedback" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
