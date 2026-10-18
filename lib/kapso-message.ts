type AlertIncident = {
  id: string;
  title: string;
  priority: string;
  node_id: string;
  created_at: string;
};

type AlertContact = { sector: string };

function plainLine(value: string, limit: number): string {
  return value
    .replace(/\s*[—–]\s*/g, ': ')
    .replace(/[\r\n\t*_~`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function priorityLabel(priority: string): string {
  switch (priority) {
    case 'high': return '🔴 ALTA';
    case 'medium': return '🟠 MEDIA';
    default: return '🔵 OBSERVACIÓN';
  }
}

export function formatKapsoAlert(incident: AlertIncident, contact: AlertContact, demo = false): string {
  const recorded = new Date(incident.created_at);
  const date = Number.isNaN(recorded.getTime())
    ? null
    : new Intl.DateTimeFormat('es-PE', {
        timeZone: 'America/Lima',
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(recorded);

  return [
    '🌿 *BOSQUE ESCUCHA*',
    demo ? '*SIMULACRO · NO ES UNA ALERTA REAL*' : '*ALERTA REVISADA*',
    '',
    `*Prioridad:* ${priorityLabel(incident.priority)}`,
    `*Indicio:* ${plainLine(incident.title, 180)}`,
    `*Sector:* ${plainLine(contact.sector, 100)}`,
    `*Nodo:* ${plainLine(incident.node_id, 64)}`,
    ...(date ? [`*Registro:* ${date} (Perú)`] : []),
    `*Caso:* ${plainLine(incident.id.slice(0, 8).toUpperCase(), 8)}`,
    '',
    ...(demo
      ? ['*Prueba de integración*', 'Audio captado por un ESP32 de demostración. No requiere intervención.']
      : ['*Siguiente paso*', 'Revisa la evidencia disponible en el centro de comando antes de intervenir.', '_El indicio no confirma actividad ilegal._']),
  ].join('\n');
}
