"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
export type MapNode = { id: string; name: string; latitude: number | null; longitude: number | null; status: string; sector: string };
type PositionedNode = MapNode & { latitude: number; longitude: number };
function positioned(node: MapNode): node is PositionedNode {
  return typeof node.latitude === "number" && typeof node.longitude === "number" && Number.isFinite(node.latitude) && Number.isFinite(node.longitude);
}
function color(node: MapNode, alerts: Record<string,string>) {
  return alerts[node.id] === "high" ? "#df624d" : alerts[node.id] === "medium" ? "#d39937" : node.status === "online" ? "#297a59" : "#718579";
}
export default function ForestMap({nodes, alerts, chainsawAlerts, onSelect}: { nodes: MapNode[]; alerts: Record<string,string>; chainsawAlerts: ReadonlySet<string>; onSelect: (id:string)=>void }) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const markers = useRef<LayerGroup | null>(null);
  const leaflet = useRef<typeof import("leaflet") | null>(null);
  const fitted = useRef(false);
  const geoWatch = useRef<number | null>(null);
  const geoLayer = useRef<LayerGroup | null>(null);
  const geoCentered = useRef(false);
  const [position, setPosition] = useState<{lat: number; lng: number; accuracy: number; time: number} | null>(null);
  const [manualAnchor, setManualAnchor] = useState<{lat: number; lng: number} | null>(null);
  const [placingAnchor, setPlacingAnchor] = useState(false);
  const [showSimulatedModules, setShowSimulatedModules] = useState(false);
  const placingAnchorRef = useRef(false);
  const manualAnchorRef = useRef(manualAnchor);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState("");
  useEffect(() => () => { if (geoWatch.current !== null) navigator.geolocation.clearWatch(geoWatch.current); }, []);
  const locate = useCallback(() => {
    if (!navigator.geolocation) { setGeoError("Este navegador no ofrece ubicación."); return; }
    if (geoWatch.current !== null) navigator.geolocation.clearWatch(geoWatch.current);
    setGeoError(""); setLocating(true); geoCentered.current = false;
    geoWatch.current = navigator.geolocation.watchPosition(p => {
      setPosition({lat:p.coords.latitude, lng:p.coords.longitude, accuracy:p.coords.accuracy, time:p.timestamp});
      setLocating(false); setGeoError("");
    }, error => {
      setLocating(false);
      setGeoError(error.code === 1 ? "Permite la ubicación en los ajustes del navegador y vuelve a intentarlo." : error.code === 3 ? "La ubicación tardó demasiado. Vuelve a intentarlo." : "No se pudo obtener tu ubicación. Comprueba la localización del dispositivo.");
      if (geoWatch.current !== null) navigator.geolocation.clearWatch(geoWatch.current);
      geoWatch.current = null;
    }, {enableHighAccuracy:true, maximumAge:0, timeout:20000});
  }, []);
  const select = useRef(onSelect);
  const [ready, setReady] = useState(0);
  const [local, setLocal] = useState(false);
  const [failure, setFailure] = useState(false);
  useEffect(() => { select.current = onSelect; }, [onSelect]);
  useEffect(() => { placingAnchorRef.current = placingAnchor; }, [placingAnchor]);
  useEffect(() => { manualAnchorRef.current = manualAnchor; }, [manualAnchor]);
  useEffect(() => {
    if (local) return;
    let disposed = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    void import("leaflet").then(L => {
      if (disposed || !element.current) return;
      leaflet.current = L;
      const instance = L.map(element.current).setView([-9.19, -75.02], 5);
      map.current = instance;
      instance.on("click", event => {
        if (!placingAnchorRef.current) return;
        const anchor = {lat:event.latlng.lat,lng:event.latlng.lng};
        setManualAnchor(anchor);
        manualAnchorRef.current = anchor;
        setShowSimulatedModules(true);
        setPlacingAnchor(false);
        placingAnchorRef.current = false;
        geoCentered.current = false;
      });
      markers.current = L.layerGroup().addTo(instance);
      geoLayer.current = L.layerGroup().addTo(instance);
      geoCentered.current = false;
      fitted.current = false;
      let errors = 0, loaded = 0;
      const fallback = () => { if (!disposed) { setFailure(true); setLocal(true); } };
      const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        referrerPolicy: "strict-origin-when-cross-origin",
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      });
      tiles.on("tileerror", () => { errors++; if (errors >= 3 && !loaded) fallback(); });
      tiles.on("tileload", () => { loaded++; if (timeout) clearTimeout(timeout); });
      tiles.addTo(instance);
      timeout = setTimeout(() => { if (!loaded) fallback(); }, 12000);
      setReady(value => value + 1);
    }).catch(() => { if (!disposed) { setFailure(true); setLocal(true); } });
    return () => {
      disposed = true;
      if (timeout) clearTimeout(timeout);
      map.current?.remove(); map.current = null; markers.current = null; geoLayer.current = null;
    };
  }, [local]);
  useEffect(() => {
    const L = leaflet.current, instance = map.current, layer = markers.current;
    if (!L || !instance || !layer || local) return;
    layer.clearLayers();
    const valid = nodes.filter(positioned);
    for (const node of valid) {
      const label = document.createElement("span");
      label.textContent = `${node.name} · ${node.sector}${node.id.startsWith("DEMO") ? " · DEMO" : ""}`;
      L.circleMarker([node.latitude,node.longitude], { radius: 10, color: "#fff", weight: 3, fillColor: color(node,alerts), fillOpacity: 1, className: chainsawAlerts.has(node.id) ? "chainsaw-alert-marker" : "" })
        .bindTooltip(label).on("click", () => select.current(node.id)).addTo(layer);
    }
    if (!fitted.current && valid.length && geoWatch.current === null) {
      instance.fitBounds(valid.map(n=>[n.latitude,n.longitude] as [number,number]), {padding:[70,70],maxZoom:13});
      fitted.current = true;
    }
  }, [nodes, alerts, chainsawAlerts, ready, local]);
  useEffect(() => {
    const L = leaflet.current, instance = map.current, layer = geoLayer.current;
    if (!L || !instance || !layer || local) return;
    layer.clearLayers();
    if (position) {
      const point: [number, number] = [position.lat, position.lng];
      L.circle(point, {radius:position.accuracy, color:"#2563eb", weight:1, fillOpacity:0.1}).addTo(layer);
      L.circleMarker(point, {radius:8, color:"#fff", weight:3, fillColor:"#2563eb", fillOpacity:1})
        .bindTooltip("Tu ubicación · precisión ±" + Math.round(position.accuracy) + " m").addTo(layer);
    }
    const anchor = manualAnchor ?? position;
    const demoPoints: [number, number][] = [];
    if (manualAnchor) {
      L.circleMarker([manualAnchor.lat, manualAnchor.lng], {radius:7,color:"#fff",weight:3,fillColor:"#2563eb",fillOpacity:1})
        .bindTooltip("Centro manual de los módulos simulados · solo visual").addTo(layer);
    }
    if (showSimulatedModules && anchor) {
      const offsets: [number, number][] = [[110,-40],[45,125],[-90,75],[-125,-65],[20,-145]];
      const powered = [true,true,false,true,false];
      offsets.forEach(([north,east], index) => {
        const lat = anchor.lat + north / 111320;
        const lng = anchor.lng + east / (111320 * Math.max(0.2, Math.cos(anchor.lat * Math.PI / 180)));
        const demoPoint: [number, number] = [lat, lng];
        demoPoints.push(demoPoint);
        const active = powered[index];
        const label = document.createElement("span");
        label.textContent = `DEMO-MIC-0${index + 1} · ${active ? "ENCENDIDO" : "APAGADO"} · SIMULADO`;
        L.circleMarker(demoPoint, {radius:8, color:active ? "#fff" : "#8b9290", weight:2, dashArray:active ? undefined : "3 3", fillColor:active ? "#298052" : "#737b78", fillOpacity:active ? 1 : .7})
          .bindTooltip(label).addTo(layer);
      });
    }
    if (manualAnchor && !geoCentered.current) {
      instance.setView([manualAnchor.lat, manualAnchor.lng], 15);
      geoCentered.current = true;
    } else if (position && !geoCentered.current) {
      const point: [number, number] = [position.lat, position.lng];
      const bounds = showSimulatedModules && anchor
        ? L.latLngBounds([point,...demoPoints])
        : L.latLng(point).toBounds(Math.max(position.accuracy, 40) * 2);
      instance.fitBounds(bounds, {maxZoom:17, padding:[50,50]});
      geoCentered.current = true; fitted.current = true;
    }
  }, [position, manualAnchor, ready, local, showSimulatedModules]);
  const valid = nodes.filter(positioned);
  const latitudes = valid.map(n=>n.latitude), longitudes = valid.map(n=>n.longitude);
  const minLat = Math.min(...latitudes), minLon = Math.min(...longitudes);
  const latRange = Math.max(...latitudes)-minLat, lonRange = Math.max(...longitudes)-minLon;
  return <div className="map-frame">
    <button className="map-mode" onClick={()=>{setFailure(false);setLocal(value=>!value)}}>{local ? "Ver OpenStreetMap" : "Plano local"}</button>
    <button className="map-mode map-locate" onClick={locate} disabled={locating}>{locating ? "Buscando ubicación…" : "Mi ubicación"}</button>
    <button className="map-mode map-simulate" onClick={()=>{const next=!showSimulatedModules;setShowSimulatedModules(next);if(next&&!manualAnchor&&!position)locate();}}>{showSimulatedModules ? "Ocultar módulos" : "Simular 5 módulos"}</button>
    {showSimulatedModules && <button className="map-mode map-place" onClick={()=>{setPlacingAnchor(true);placingAnchorRef.current=true;setGeoError("Haz clic en el mapa para colocar los módulos simulados.");}}>{placingAnchor ? "Haz clic en el mapa…" : "Colocar módulos"}</button>}
    {(position || geoError || locating) && <div className="map-location-status" role="status" aria-live="polite">
      {geoError || (locating ? "Permite el acceso a tu ubicación cuando lo solicite el navegador." : position && <><strong>Tu ubicación</strong> {position.lat.toFixed(6)}, {position.lng.toFixed(6)} · precisión ±{Math.round(position.accuracy)} m · {new Date(position.time).toLocaleTimeString()}<br/><small>Visible solo en este navegador.{local ? " Abre OpenStreetMap para verla sobre el mapa." : " El círculo azul indica el margen de precisión."}</small></>)}
    </div>}
    {showSimulatedModules && (manualAnchor || position) && <div className="map-location-status" role="status"><strong>5 módulos simulados · 3 encendidos · 2 apagados</strong><br/><small>Solo visuales. Sin audio, análisis ni alertas.</small></div>}
    {local ? <div className="forest-map schematic-map" aria-label="Plano esquemático local de nodos" onClick={event=>{if(!placingAnchor)return;const rect=event.currentTarget.getBoundingClientRect();const x=(event.clientX-rect.left)/rect.width;const y=(event.clientY-rect.top)/rect.height;const anchor={lat:-9.19+(0.5-y)*0.03,lng:-75.02+(x-0.5)*0.04};setManualAnchor(anchor);manualAnchorRef.current=anchor;setShowSimulatedModules(true);setPlacingAnchor(false);placingAnchorRef.current=false;setGeoError("");}}>
      <div className="schematic-heading"><strong>Plano de sectores</strong><span>{failure ? "Cartografía externa no disponible" : "Disponible sin cartografía externa"} · ubicación relativa</span></div>
      {!valid.length && <p className="schematic-empty">Configura las coordenadas de un nodo para ubicarlo aquí.</p>}
      {valid.map(n=><button key={n.id} className={`schematic-node ${chainsawAlerts.has(n.id)?"schematic-node-alert":""}`} style={{left:`${lonRange ? 18+(n.longitude-minLon)/lonRange*64 : 50}%`,top:`${latRange ? 72-(n.latitude-minLat)/latRange*40 : 50}%`}} onClick={()=>onSelect(n.id)}><i style={{background:color(n,alerts)}}/><strong>{n.id}</strong><small>{n.latitude.toFixed(4)}, {n.longitude.toFixed(4)}</small>{n.id.startsWith("DEMO")&&<em>DEMO</em>}</button>)}
      {showSimulatedModules && manualAnchor && [true,true,false,true,false].map((active,index)=><span key={index} className={`schematic-sim-module ${active?"powered-on":"powered-off"}`} style={{left:`${50+[-22,24,16,-27,4][index]}%`,top:`${50+[-16,-13,20,17,29][index]}%`}}><i/><b>MIC-0{index+1}</b><small>{active?"ENCENDIDO":"APAGADO"} · DEMO</small></span>)}
      <span className="schematic-note">Esquema orientativo · no representa caminos ni distancias de campo</span>
    </div> : <div ref={element} className="forest-map" aria-label="Mapa de ubicaciones registradas de nodos"/>}
  </div>;
}
