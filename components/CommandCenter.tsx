"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  AudioLines,
  Check,
  ChevronRight,
  Cloud,
  CloudOff,
  Eye,
  FileImage,
  LayoutDashboard,
  Leaf,
  Lock,
  MapPin,
  Radio,
  RefreshCw,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  TreePine,
  TriangleAlert,
  X,
} from "lucide-react";
import { IncidentAssistant } from "@/components/IncidentAssistant";
import { publicDemo } from "@/lib/public-demo";
import { OperationsSettings } from "@/components/OperationsSettings";
import { NotificationReceipt } from "@/components/NotificationReceipt";
import ForestMap from "@/components/ForestMap";
import type { DashboardData as Dashboard, Incident, ForestEvent } from "@/lib/types";
import {
  Badge,
  time,
  types,
  statuses,
  priorities,
} from "@/components/dashboard-ui";
import { EventTable, Evidence } from "@/components/Evidence";
const tabs = [
  { name: "Panorama", icon: LayoutDashboard },
  { name: "Incidentes", icon: TriangleAlert },
  { name: "Nodos", icon: Radio },
  { name: "Evidencias", icon: FileImage },
  { name: "Actividad", icon: Activity },
  { name: "Ajustes", icon: Settings },
];
export default function Home() {
  const [tab, setTab] = useState("Panorama"),
    [data, setData] = useState<Dashboard | null>(null),
    [error, setError] = useState(""),
    [synced, setSynced] = useState(""),
    [authenticated, setAuthenticated] = useState(false),
    [login, setLogin] = useState(false),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [note, setNote] = useState(""),
    [assignee, setAssignee] = useState(""),
    [filter, setFilter] = useState("all"),
    [date, setDate] = useState("");
  const demoState = useRef<Dashboard | null>(null);
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw Error(body.error || "No se pudo sincronizar");
      if (body.authenticated) {
        const testNode = (id: string) => id.startsWith("DEMO") || id === "CHECK-LOCAL";
        const events = body.events.filter((e: ForestEvent) => !testNode(e.node_id) && e.source !== "demo" && !e.metadata?.synthetic_control);
        const incidents = body.incidents.filter((i: Incident) => !testNode(i.node_id));
        const ids = new Set(incidents.map((i: Incident) => i.id));
        setData({...body, nodes:body.nodes.filter((n: {id:string}) => !testNode(n.id)), events, incidents,
          notifications:body.notifications.filter((n: {incident_id:string}) => ids.has(n.incident_id)),
          audit:body.audit.filter((a: {incident_id:string}) => ids.has(a.incident_id))});
      } else {
        demoState.current ??= publicDemo();
        setData(demoState.current);
      }
      if (typeof body.authenticated === "boolean")
        setAuthenticated(body.authenticated);
      setError(body.error || "");
      setSynced(new Date().toISOString());
    } catch (err) {
      demoState.current ??= publicDemo();
      setData((current) => current?.authenticated ? current : demoState.current);
      setError(err instanceof Error ? err.message : "No se pudo conectar al centro");
    }
  }, []);
  useEffect(() => {
    void refresh();
    void fetch("/api/session")
      .then((r) => r.json())
      .then((r) => setAuthenticated(!!r.authenticated))
      .catch(() => {});
    const timer = setInterval(refresh, 10000);
    return () => clearInterval(timer);
  }, [refresh]);
  const mutate = async (url: string, body: unknown, method = "POST") => {
    if (!authenticated) {
      const payload = body as Record<string, string>;
      const current = demoState.current ?? publicDemo();
      if (url === "/api/demo") {
        demoState.current = publicDemo(payload.scenario);
        setSelected(null);
        setTab("Panorama");
      } else if (url.startsWith("/api/incidents/")) {
        const id = url.split("/")[3];
        const now = new Date().toISOString();
        const notification = url.endsWith("/notify");
        demoState.current = {
          ...current,
          incidents: current.incidents.map(i => i.id === id && !notification ? { ...i, ...payload, updated_at: now } as Incident : i),
          audit: [{ id: crypto.randomUUID(), incident_id: id, action: notification ? "DEMO · Aprobación de notificación simulada" : `DEMO · ${payload.status ? statuses[payload.status] : "Prioridad actualizada"}`, actor: "Visitante de la demo", details: payload, created_at: now }, ...current.audit],
          notifications: notification && !current.notifications.some(n => n.incident_id === id) ? [{ id: crypto.randomUUID(), incident_id: id, channel: "DEMO · Sin envío externo", status: "blocked", approved_by: "Visitante", created_at: now, sent_at: null, last_error: "Simulación: no se envían mensajes reales." }, ...current.notifications] : current.notifications,
        };
      } else return false;
      setData(demoState.current);
      setMessage("Cambio simulado en este navegador. No modifica operaciones reales.");
      return true;
    }
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok) {
        if (res.status === 401) setLogin(true);
        throw Error(result.error || "No se pudo completar la acción");
      }
      await refresh();
      setMessage(result.message || "Cambio guardado correctamente.");
      return true;
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "No se pudo guardar");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const incidents = (data?.incidents || []).filter(
    (i) =>
      (filter === "all" || i.status === filter) &&
      (!date || i.created_at.slice(0, 10) === date),
  );
  const open = (data?.incidents || []).filter(
    (i) => !["closed", "discarded"].includes(i.status),
  );
  const selectedIncident = data?.incidents.find((i) => i.id === selected);
  const alerts = useMemo(() => {
    const result: Record<string, string> = {};
    data?.incidents
      .filter((i) => !["closed", "discarded"].includes(i.status))
      .forEach((i) => {
        if (result[i.node_id] !== "high") result[i.node_id] = i.priority;
      });
    return result;
  }, [data]);
  const selectNode = useCallback(
    (id: string) => {
      const incident = data?.incidents.find(
        (i) => i.node_id === id && !["closed", "discarded"].includes(i.status),
      );
      if (incident) setSelected(incident.id);
      else setTab("Nodos");
    },
    [data],
  );
  const selectIncident = (id: string) => {
    setSelected(id);
    setNote("");
    setAssignee("");
    setMessage("");
  };
  const isDemo = (incident: Incident) =>
    incident.node_id.startsWith("DEMO") ||
    data?.events.some(
      (e) => incident.event_ids.includes(e.id) && e.source === "demo",
    );
  const changeStatus = async (status: string) => {
    if (!selectedIncident) return;
    if (!note.trim()) {
      setMessage("Añade una nota para registrar el motivo de tu decisión.");
      return;
    }
    await mutate(
      `/api/incidents/${selectedIncident.id}`,
      { status, review_note: note, assigned_to: assignee || undefined },
      "PATCH",
    );
  };
  const incidentCard = (i: Incident) => (
    <button
      className={`incident-card ${selected === i.id ? "selected" : ""}`}
      key={i.id}
      onClick={() => selectIncident(i.id)}
    >
      <div className="incident-top">
        <Badge tone={i.priority}>{priorities[i.priority] || i.priority}</Badge>
        <span className="tiny mono">{time(i.created_at)}</span>
      </div>
      <h3>{i.title}</h3>
      <p>
        <MapPin size={12} />
        {data?.nodes.find((n) => n.id === i.node_id)?.sector || i.node_id}
        {isDemo(i) && <span className="demo-label">DEMO</span>}
      </p>
      <div className="incident-bottom">
        <span>{statuses[i.status] || i.status}</span>
        <ArrowUpRight size={16} />
      </div>
    </button>
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/">
          <span className="brand-icon">
            <TreePine size={27} />
          </span>
          <span>
            Bosque<span className="brand-light">Escucha</span>
          </span>
        </a>
        <div className="workspace-label">CENTRO DE COMANDO</div>
        <nav>
          {tabs.map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={tab === name ? "active" : ""}
              onClick={() => setTab(name)}
            >
              <Icon size={18} />
              <span>{name}</span>
              {name === "Incidentes" && open.length > 0 && <b>{open.length}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="territory">
            <span className="territory-icon">
              <Leaf size={19} />
            </span>
            <div>
              <strong>Hack the Andes</strong>
              <span>Clima y territorio · 2026</span>
            </div>
          </div>
          <button
            className="operator"
            onClick={() =>
              authenticated
                ? void fetch("/api/session", { method: "DELETE" }).then(() => {
                    setAuthenticated(false);
                    void refresh();
                  })
                : setLogin(true)
            }
          >
            <span className="avatar">{authenticated ? "OP" : "VI"}</span>
            <span>
              <strong>{authenticated ? "Operador" : "Vista pública"}</strong>
              <small>
                {authenticated ? "Cerrar sesión" : "Acceso del equipo"}
              </small>
            </span>
            <ChevronRight size={16} />
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            Centro de comando <ChevronRight size={14} />
            <strong>{tab}</strong>
          </div>
          <div className="header-right">
            <span className={`connection ${error ? "disconnected" : ""}`}>
              {error ? <CloudOff size={14} /> : <Cloud size={14} />}{" "}
              {error
                ? "Sin sincronización"
                : synced
                  ? authenticated ? "Nube sincronizada" : "Demo en tu navegador"
                  : "Conectando"}
            </span>
            <span className="header-divider" />
            <button
              className="icon-button"
              title="Actualizar datos"
              onClick={() => void refresh()}
            >
              <RefreshCw size={16} />
            </button>
            <span className="avatar small">BE</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span className="green-line" /> VIGILANCIA CON EVIDENCIA
              </div>
              <h1>
                {tab === "Panorama" ? "El bosque tiene algo que decir." : tab}
              </h1>
              <p>
                {tab === "Panorama"
                  ? "Escucha, verifica y coordina la respuesta desde un solo lugar."
                  : {
                      Incidentes:
                        "Revisa los indicios y registra cada decisión.",
                      Nodos: "Estado reportado por los nodos de monitoreo.",
                      Evidencias:
                        "Audio e imágenes asociados a cada detección.",
                      Actividad:
                        "Historial de decisiones y notificaciones del centro.",
                      Ajustes:
                        "Conectividad, acceso y herramientas para la demostración.",
                    }[tab]}
              </p>
            </div>
            <button
              className="button primary"
              onClick={() =>
                setTab("Ajustes")
              }
            >
              {authenticated ? (
                <SlidersHorizontal size={15} />
              ) : (
                <AudioLines size={15} />
              )}{" "}
              {authenticated ? "Herramientas demo" : "Probar escenarios"}
            </button>
          </div>
          {!authenticated && (
            <div className="public-banner">
              <span>
                <Eye size={15} />
                <strong>Demo interactiva sin registro</strong> Revisa un incidente, toma una decisión y simula una notificación. Datos y scores sintéticos; cambios solo en este navegador.
              </span>
              <button onClick={() => { void mutate("/api/demo", { scenario: "combined" }); setSelected("demo-incident"); }}>
                Probar el flujo <ArrowUpRight size={13} />
              </button>
            </div>
          )}
          {error && (
            <div className="error-banner">
              <CloudOff size={17} />
              <span>
                {error}.{" "}
                {data
                  ? "Se conserva la última información recibida."
                  : "No hay datos disponibles por el momento."}
              </span>
              <button onClick={() => void refresh()}>Reintentar</button>
            </div>
          )}
          {data && !data.configured && (
            <div className="notice-banner">
              Entorno de demostración · La base operativa todavía no está
              configurada.
            </div>
          )}
          {!data && !error && (
            <div className="loading">
              <RefreshCw className="spin" size={25} />
              <p>Conectando con el centro de comando…</p>
            </div>
          )}
          {data && (
            <>
              {tab === "Panorama" && (
                <>
                  <div className="metrics">
                    <div className="metric">
                      <span>
                        <Radio size={17} /> Nodos reportados
                      </span>
                      <strong>
                        {data.nodes.length}
                        <small>
                          {" "}
                          /{" "}
                          {
                            data.nodes.filter((n) => n.status === "online")
                              .length
                          }{" "}
                          en línea
                        </small>
                      </strong>
                      <p>Estado recibido del dispositivo</p>
                    </div>
                    <div className="metric">
                      <span>
                        <TriangleAlert size={17} /> Incidentes abiertos
                      </span>
                      <strong>
                        {open.length}
                        <small className="orange-text">
                          {open.filter((i) => i.priority === "high").length} de
                          prioridad alta
                        </small>
                      </strong>
                      <p>Pendientes de atención</p>
                    </div>
                    <div className="metric">
                      <span>
                        <AudioLines size={17} /> Eventos registrados
                      </span>
                      <strong>
                        {data.events.length}
                        <small>audio + visión</small>
                      </strong>
                      <p>Indicios sujetos a verificación</p>
                    </div>
                    <div className="metric">
                      <span>
                        <ShieldCheck size={17} /> Revisiones completadas
                      </span>
                      <strong>
                        {
                          data.incidents.filter(
                            (i) => i.status !== "pending_review",
                          ).length
                        }
                        <small>decisiones humanas</small>
                      </strong>
                      <p>Cada decisión deja un registro</p>
                    </div>
                  </div>
                  <div className="overview-grid">
                    <section className="panel map-panel">
                      <div className="panel-head">
                        <div>
                          <h2>
                            <MapPin size={17} /> Territorio en observación
                          </h2>
                          <p>Ubicación registrada de los nodos</p>
                        </div>
                        <Badge tone="green">{data.nodes.length} nodos</Badge>
                      </div>
                      <div className="map-container">
                        <ForestMap
                          nodes={data.nodes}
                          alerts={alerts}
                          onSelect={selectNode}
                        />
                        <span className="map-caption">
                          Posiciones de nodos · los sectores DEMO son simulados
                        </span>
                        {data.nodes.length === 0 && (
                          <div className="map-no-nodes">
                            Aún no hay nodos registrados
                          </div>
                        )}
                      </div>
                      <div className="map-legend">
                        <span>
                          <i className="dot green" />
                          En línea
                        </span>
                        <span>
                          <i className="dot amber" />
                          Prioridad media
                        </span>
                        <span>
                          <i className="dot red" />
                          Prioridad alta
                        </span>
                        <span>
                          <i className="dot gray" />
                          Sin conexión
                        </span>
                      </div>
                    </section>
                    <section className="panel queue">
                      <div className="panel-head">
                        <div>
                          <h2>
                            Requieren atención{" "}
                            <span className="count">{open.length}</span>
                          </h2>
                          <p>Revisa la evidencia antes de actuar</p>
                        </div>
                      </div>
                      <div className="queue-items">
                        {open.slice(0, 4).map(incidentCard)}
                        {!open.length && (
                          <div className="empty">
                            <ShieldCheck size={30} />
                            <h3>Sin incidentes abiertos</h3>
                            <p>Los nuevos indicios aparecerán aquí.</p>
                          </div>
                        )}
                      </div>
                      <button
                        className="view-all"
                        onClick={() => setTab("Incidentes")}
                      >
                        Ver todos los incidentes <ArrowUpRight size={15} />
                      </button>
                    </section>
                  </div>
                  <section className="panel events-panel">
                    <div className="panel-head">
                      <div>
                        <h2>Lo último que escuchamos</h2>
                        <p>Actividad reciente de los sensores</p>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => setTab("Evidencias")}
                      >
                        Ver evidencias <ArrowUpRight size={14} />
                      </button>
                    </div>
                    <EventTable events={data.events.slice(0, 5)} />
                  </section>
                </>
              )}
              {tab === "Incidentes" && (
                <>
                  <div className="filters">
                    <label>
                      Estado
                      <select
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                      >
                        <option value="all">Todos los estados</option>
                        {[
                          "pending_review",
                          "verified",
                          "assigned",
                          "closed",
                          "discarded",
                        ].map((s) => (
                          <option key={s} value={s}>
                            {statuses[s]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Fecha
                      <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                      />
                    </label>
                    <button
                      className="text-button"
                      onClick={() => {
                        setDate("");
                        setFilter("all");
                      }}
                    >
                      Limpiar filtros
                    </button>
                  </div>
                  <div className="incident-grid">
                    {incidents.map(incidentCard)}
                  </div>
                  {!incidents.length && (
                    <div className="empty panel">
                      No hay incidentes para estos filtros.
                    </div>
                  )}
                </>
              )}
              {tab === "Nodos" && (
                <div className="node-grid">
                  {data.nodes.map((n) => (
                    <article className="panel node-card" key={n.id}>
                      <div className="node-icon">
                        <Radio size={25} />
                      </div>
                      <div className="node-heading">
                        <h2>{n.name}</h2>
                        <Badge
                          tone={n.status === "online" ? "green" : "neutral"}
                        >
                          {statuses[n.status] || n.status}
                        </Badge>
                      </div>
                      <p>
                        {n.sector}{" "}
                        {n.id.startsWith("DEMO") && (
                          <span className="demo-label">DEMO</span>
                        )}
                      </p>
                      <dl>
                        <dt>Identificador</dt>
                        <dd className="mono">{n.id}</dd>
                        <dt>Último contacto</dt>
                        <dd>{time(n.last_seen)}</dd>
                        <dt>Batería reportada</dt>
                        <dd>
                          {n.battery_pct === null
                            ? "Sin medición"
                            : `${n.battery_pct}%`}
                        </dd>
                        <dt>Coordenadas</dt>
                        <dd>
                          {n.latitude !== null && n.longitude !== null
                            ? `${n.latitude}, ${n.longitude}`
                            : "Sin ubicación"}
                        </dd>
                      </dl>
                    </article>
                  ))}
                  {!data.nodes.length && (
                    <div className="empty panel">Esperando el primer nodo.</div>
                  )}
                </div>
              )}
              {tab === "Evidencias" && (
                <section className="panel">
                  <div className="panel-head">
                    <h2>Registro de detecciones</h2>
                    <Badge>{data.events.length} eventos</Badge>
                  </div>
                  <EventTable events={data.events} />
                  <div className="evidence-grid">
                    {data.events
                      .filter((e) => e.evidence_path)
                      .map((e) => (
                        <Evidence
                          event={e}
                          authenticated={authenticated}
                          key={e.id}
                        />
                      ))}
                  </div>
                </section>
              )}
              {tab === "Actividad" && (
                <div className="activity-grid">
                  <section className="panel">
                    <div className="panel-head">
                      <h2>Trazabilidad de decisiones</h2>
                    </div>
                    {data.audit.map((a) => (
                      <div className="audit-row" key={a.id}>
                        <span className="audit-icon">
                          <Check size={15} />
                        </span>
                        <div>
                          <strong>{a.action}</strong>
                          <p>
                            {a.actor} ·{" "}
                            {a.incident_id?.slice(0, 8) || "Sistema"}
                          </p>
                        </div>
                        <time>{time(a.created_at)}</time>
                      </div>
                    ))}
                    {!data.audit.length && (
                      <div className="empty">
                        Todavía no hay decisiones registradas.
                      </div>
                    )}
                  </section>
                  <section className="panel">
                    <div className="panel-head">
                      <h2>Notificaciones</h2>
                    </div>
                    {data.notifications.map((n) => (
                      <div className="notification-row" key={n.id}>
                        <div>
                          <strong>{n.channel}</strong>
                          <p>{n.incident_id.slice(0, 8)}</p>
                          {n.last_error && <small>{n.last_error}</small>}
                          <NotificationReceipt
                            notification={
                              n as typeof n & {
                                delivered_at?: string | null;
                                acknowledged_at?: string | null;
                                acknowledged_by?: string | null;
                              }
                            }
                          />
                        </div>
                        <Badge
                          tone={n.status === "failed" ? "high" : "neutral"}
                        >
                          {statuses[n.status] || n.status}
                        </Badge>
                      </div>
                    ))}
                    {!data.notifications.length && (
                      <div className="empty">
                        No se han aprobado notificaciones.
                      </div>
                    )}
                  </section>
                </div>
              )}
              {tab === "Ajustes" && (
                <div className="settings-grid">
                  <section className="panel settings-card">
                    <h2>
                      <Cloud size={20} /> Estado del centro
                    </h2>
                    <dl>
                      <dt>Base de datos</dt>
                      <dd>
                        {data.configured
                          ? "Configurada"
                          : "Pendiente de configurar"}
                      </dd>
                      <dt>Última sincronización</dt>
                      <dd>{time(synced)}</dd>
                      <dt>Actualización</dt>
                      <dd>Cada 10 segundos</dd>
                      <dt>Acceso</dt>
                      <dd>
                        {authenticated
                          ? "Operador autenticado"
                          : "Demostración pública"}
                      </dd>
                    </dl>
                    <p className="muted">
                      Esta web muestra los eventos sincronizados. La captura e
                      inferencia local continúan en la laptop del centro.
                    </p>
                  </section>
                  <section className="panel settings-card">
                    <h2>
                      <AudioLines size={20} /> Laboratorio de demostración
                    </h2>
                    <p>
                      Crea eventos sintéticos identificados como DEMO para
                      recorrer el flujo de revisión.
                    </p>
                    <div className="demo-actions">
                      {[
                        {
                          id: "combined",
                          title: "Motosierra + persona",
                          description:
                            "Correlación de indicios · prioridad alta",
                        },
                        {
                          id: "chainsaw",
                          title: "Motosierra persistente",
                          description: "Indicio acústico · prioridad media",
                        },
                        {
                          id: "ambient",
                          title: "Sonido ambiente",
                          description: "Registro sin crear incidente",
                        },
                      ].map((s) => (
                        <button
                          className="demo-button"
                          disabled={busy}
                          key={s.id}
                          onClick={() =>
                            void mutate("/api/demo", { scenario: s.id })
                          }
                        >
                          <span>
                            <strong>{s.title}</strong>
                            <small>{s.description}</small>
                          </span>
                          <ArrowUpRight size={17} />
                        </button>
                      ))}
                    </div>
                    <p className="tiny">
                      Los escenarios no equivalen a una prueba de los sensores
                      ni de los modelos.
                    </p>
                  </section>
                </div>
              )}
              {tab === "Ajustes" && authenticated && (
                <OperationsSettings
                  authenticated={authenticated}
                  onLogin={() => setLogin(true)}
                  onRefresh={() => void refresh()}
                />
              )}
            </>
          )}
          {message && !selected && (
            <div className="feedback" role="status">
              {message}
              <button onClick={() => setMessage("")}>
                <X size={15} />
              </button>
            </div>
          )}
          <footer>
            <span>
              <TreePine size={13} /> Bosque Escucha{" "}
              <span className="footer-separator">/</span> Tecnología para cuidar
              el territorio
            </span>
            <span>Última sincronización: {time(synced)} PET</span>
          </footer>
        </main>
      </div>
      {selectedIncident && (
        <div className="drawer-backdrop" onClick={() => setSelected(null)}>
          <aside
            className="detail-drawer"
            aria-label="Detalle del incidente"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="drawer-top">
              <span className="eyebrow">FICHA DE INCIDENTE</span>
              <button
                className="icon-button"
                onClick={() => setSelected(null)}
                aria-label="Cerrar ficha"
              >
                <X size={20} />
              </button>
            </div>
            <div className="detail-badges">
              <Badge tone={selectedIncident.priority}>
                Prioridad {priorities[selectedIncident.priority]}
              </Badge>
              {isDemo(selectedIncident) && (
                <Badge tone="amber">DEMO · Sintético</Badge>
              )}
            </div>
            <h2>{selectedIncident.title}</h2>
            <p className="muted">
              {selectedIncident.node_id} · {time(selectedIncident.created_at)}{" "}
              PET
            </p>
            <span className="mono tiny">{selectedIncident.id}</span>
            <div className="reason-box">
              <strong>Por qué se priorizó</strong>
              <p>{selectedIncident.summary}</p>
              <small>
                Indicios para inspección; no confirman tala ilegal ni identidad.
              </small>
            </div>
            <IncidentAssistant key={selectedIncident.id} incident={selectedIncident} authenticated={authenticated} />
            <h3>Evidencia asociada</h3>
            {data?.events
              .filter((e) => selectedIncident.event_ids.includes(e.id))
              .map((e) => (
                <Evidence key={e.id} event={e} authenticated={authenticated} />
              ))}
            {!data?.events.some((e) =>
              selectedIncident.event_ids.includes(e.id),
            ) && <p className="muted">No hay evidencia asociada disponible.</p>}
            <div className="review-section">
              <h3>Revisión del operador</h3>
              <Badge>{statuses[selectedIncident.status]}</Badge>
              {selectedIncident.review_note && (
                <p className="saved-note">
                  Última nota: {selectedIncident.review_note}
                </p>
              )}
              {selectedIncident.assigned_to && (
                <p>
                  Asignado a: <strong>{selectedIncident.assigned_to}</strong>
                </p>
              )}
              {(authenticated || data?.mode === "demo") ? (
                <>
                  {!authenticated && <p className="notice-banner">Prueba libre · Las decisiones son simuladas y se reinician al recargar. No hay capturas reales en este escenario.</p>}
                  <label>
                    Nota de revisión
                    <textarea
                      placeholder="Describe lo que verificaste y el motivo de la decisión…"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </label>
                  {selectedIncident.status === "verified" && (
                    <label>
                      Responsable
                      <input
                        value={assignee}
                        onChange={(e) => setAssignee(e.target.value)}
                        placeholder="Nombre o contacto acordado"
                      />
                    </label>
                  )}
                  <label>
                    Prioridad revisada
                    <select
                      value={selectedIncident.priority}
                      disabled={busy}
                      onChange={(event) => {
                        if (!note.trim()) {
                          setMessage(
                            "Añade una nota para justificar el cambio de prioridad.",
                          );
                          return;
                        }
                        void mutate(
                          `/api/incidents/${selectedIncident.id}`,
                          { priority: event.target.value, review_note: note },
                          "PATCH",
                        );
                      }}
                    >
                      <option value="high">Alta</option>
                      <option value="medium">Media</option>
                      <option value="observation">Observación</option>
                    </select>
                  </label>
                  <div className="review-actions">
                    {selectedIncident.status === "pending_review" && (
                      <>
                        <button
                          className="button primary"
                          disabled={busy}
                          onClick={() => void changeStatus("verified")}
                        >
                          <Check size={15} />
                          Verificar
                        </button>
                        <button
                          className="button"
                          disabled={busy}
                          onClick={() => void changeStatus("discarded")}
                        >
                          Descartar
                        </button>
                      </>
                    )}
                    {selectedIncident.status === "verified" && (
                      <button
                        className="button primary"
                        disabled={busy || !assignee.trim()}
                        onClick={() => void changeStatus("assigned")}
                      >
                        Asignar responsable
                      </button>
                    )}
                    {["verified", "assigned"].includes(
                      selectedIncident.status,
                    ) && (
                      <>
                        <button
                          className="button"
                          disabled={busy}
                          onClick={() => void changeStatus("closed")}
                        >
                          Cerrar incidente
                        </button>
                        <button
                          className="button notify-button"
                          disabled={busy}
                          onClick={() =>
                            void mutate(
                              `/api/incidents/${selectedIncident.id}/notify`,
                              { approved: true },
                            )
                          }
                        >
                          {authenticated ? "Aprobar notificación" : "Simular aprobación"}
                        </button>
                      </>
                    )}
                  </div>
                  <p className="tiny muted">
                    {authenticated ? "La aprobación registra la solicitud de envío. Consulta su estado en Actividad." : "La demo registra la aprobación en Actividad; no envía mensajes a nadie."}
                  </p>
                </>
              ) : (
                <button
                  className="button primary"
                  onClick={() => setLogin(true)}
                >
                  <Lock size={15} />
                  Ingresar para revisar
                </button>
              )}
              {message && (
                <p className="inline-feedback" role="status">
                  {message}
                </p>
              )}
            </div>
          </aside>
        </div>
      )}
      {login && (
        <div className="modal-backdrop">
          <form
            className="login-modal"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                const res = await fetch("/api/session", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ password }),
                });
                const result = await res.json();
                if (!res.ok) throw Error(result.error || "No se pudo ingresar");
                setAuthenticated(true);
                setLogin(false);
                setPassword("");
                setMessage("");
                await refresh();
              } catch (err) {
                setMessage(
                  err instanceof Error ? err.message : "Error de acceso",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <button
              type="button"
              className="modal-close icon-button"
              aria-label="Cerrar acceso"
              onClick={() => {
                setLogin(false);
                setMessage("");
              }}
            >
              <X size={19} />
            </button>
            <div className="login-symbol">
              <TreePine size={32} />
            </div>
            <h2>Acceso al centro</h2>
            <p>
              Ingresa la contraseña del operador para revisar evidencia y
              coordinar la respuesta.
            </p>
            <label>
              Contraseña
              <input
                type="password"
                required
                autoFocus
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {message && (
              <p role="alert" className="login-error">
                {message}
              </p>
            )}
            <button className="button primary" disabled={busy}>
              {busy ? "Validando…" : "Ingresar como operador"}
              <ArrowUpRight size={16} />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
