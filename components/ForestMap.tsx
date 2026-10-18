"use client";
import { useEffect, useRef } from "react";
export type MapNode = {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  status: string;
  sector: string;
};
export default function ForestMap({
  nodes,
  alerts,
  onSelect,
}: {
  nodes: MapNode[];
  alerts: Record<string, string>;
  onSelect: (id: string) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    void import("leaflet").then((L) => {
      if (disposed || !element.current) return;
      const map = L.map(element.current).setView([-12.84, -69.29], 10);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap",
      }).addTo(map);
      const valid = nodes.filter(
        (n): n is MapNode & { latitude: number; longitude: number } =>
          typeof n.latitude === "number" &&
          typeof n.longitude === "number" &&
          Number.isFinite(n.latitude) &&
          Number.isFinite(n.longitude),
      );
      valid.forEach((n) => {
        const color =
          alerts[n.id] === "high"
            ? "#df624d"
            : alerts[n.id] === "medium"
              ? "#d39937"
              : n.status === "online"
                ? "#297a59"
                : "#718579";
        L.circle([n.latitude, n.longitude], {
          radius: 220,
          color,
          weight: 1,
          fillOpacity: 0.08,
        }).addTo(map);
        const tooltip = document.createElement("span");
        tooltip.textContent = `${n.name} · ${n.sector}${n.id.startsWith("DEMO") ? " · DEMO" : ""}`;
        L.circleMarker([n.latitude, n.longitude], {
          radius: 9,
          color: "#fff",
          weight: 3,
          fillColor: color,
          fillOpacity: 1,
        })
          .bindTooltip(tooltip)
          .on("click", () => onSelect(n.id))
          .addTo(map);
      });
      if (valid.length)
        map.fitBounds(
          valid.map((n) => [n.latitude, n.longitude] as [number, number]),
          { padding: [70, 70], maxZoom: 13 },
        );
      cleanup = () => map.remove();
    });
    return () => {
      disposed = true;
      cleanup();
    };
  }, [nodes, alerts, onSelect]);
  return (
    <div
      ref={element}
      className="forest-map"
      aria-label="Mapa de ubicaciones registradas de nodos"
    />
  );
}
