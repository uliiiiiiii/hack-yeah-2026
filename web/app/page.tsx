"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  getRoute,
  RouteRequestError,
  type LatLon,
  type RouteFeature,
  type RouteProperties,
} from "@/lib/api";
import styles from "./page.module.css";

const MAP_STYLE =
  process.env.NEXT_PUBLIC_MAP_STYLE_URL ??
  "https://tiles.openfreemap.org/styles/liberty";
const KRAKOW_CENTER: [number, number] = [19.94, 50.06];
const ROUTE_SOURCE = "route";

type Status = "idle" | "start-set" | "loading" | "route-ready" | "error";

function parseLatLon(text: string): LatLon | null {
  const parts = text.split(",");
  if (parts.length !== 2) return null;
  const lat = Number(parts[0].trim());
  const lon = Number(parts[1].trim());
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

const fmt = (p: LatLon) => `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;

function markerElement(label: string, cls: "start" | "end"): HTMLDivElement {
  const el = document.createElement("div");
  el.className = `route-marker ${cls}`;
  el.setAttribute("aria-hidden", "true"); // decorative; state is announced in the panel
  const span = document.createElement("span");
  span.textContent = label;
  el.appendChild(span);
  return el;
}

export default function Page() {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapReady = useRef(false);
  const startMarker = useRef<maplibregl.Marker | null>(null);
  const endMarker = useRef<maplibregl.Marker | null>(null);
  const startPt = useRef<LatLon | null>(null);
  const endPt = useRef<LatLon | null>(null);
  const reduceMotion = useRef(false);
  // A route requested before the map's style has loaded; drawn once 'load' fires.
  const pendingFeature = useRef<RouteFeature | null>(null);

  const [status, setStatus] = useState<Status>("idle");
  const [props, setProps] = useState<RouteProperties | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [startText, setStartText] = useState("");
  const [endText, setEndText] = useState("");

  const drawRoute = useCallback((feature: RouteFeature) => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource(ROUTE_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!src) {
      // Style/source not ready yet (tiles still loading): draw it on 'load'.
      pendingFeature.current = feature;
      return;
    }
    src.setData(feature as unknown as GeoJSON.Feature);

    const coords = feature.geometry.coordinates;
    const bounds = coords.reduce(
      (b, c) => b.extend(c as [number, number]),
      new maplibregl.LngLatBounds(
        coords[0] as [number, number],
        coords[0] as [number, number],
      ),
    );
    // Keep the route clear of the panel: it sits on the left on wide screens and
    // docks to the bottom on narrow ones (see page.module.css).
    const narrow = window.innerWidth < 520;
    const padding = narrow
      ? { top: 40, bottom: Math.round(window.innerHeight * 0.5), left: 30, right: 30 }
      : { top: 60, bottom: 60, left: 360, right: 60 };
    map.fitBounds(bounds, { padding, animate: !reduceMotion.current });
  }, []);

  const clearRouteLine = useCallback(() => {
    const map = mapRef.current;
    const src = map?.getSource(ROUTE_SOURCE) as maplibregl.GeoJSONSource | undefined;
    src?.setData({ type: "FeatureCollection", features: [] });
  }, []);

  const requestRoute = useCallback(
    async (from: LatLon, to: LatLon) => {
      setStatus("loading");
      setErrorMsg("");
      try {
        const feature = await getRoute(from, to);
        drawRoute(feature);
        setProps(feature.properties);
        setStatus("route-ready");
      } catch (err) {
        clearRouteLine();
        setProps(null);
        setStatus("error");
        setErrorMsg(
          err instanceof RouteRequestError
            ? err.message
            : "Something went wrong requesting the route.",
        );
      }
    },
    [drawRoute, clearRouteLine],
  );

  const placeMarker = useCallback(
    (which: "start" | "end", p: LatLon) => {
      const map = mapRef.current;
      if (!map) return;
      const ref = which === "start" ? startMarker : endMarker;
      const lngLat: [number, number] = [p.lon, p.lat];
      if (!ref.current) {
        const marker = new maplibregl.Marker({
          element: markerElement(which === "start" ? "A" : "B", which),
          draggable: true,
          anchor: "bottom",
        })
          .setLngLat(lngLat)
          .addTo(map);
        marker.on("dragend", () => {
          const ll = marker.getLngLat();
          const np: LatLon = { lat: ll.lat, lon: ll.lng };
          if (which === "start") {
            startPt.current = np;
            setStartText(fmt(np));
          } else {
            endPt.current = np;
            setEndText(fmt(np));
          }
          if (startPt.current && endPt.current) {
            void requestRoute(startPt.current, endPt.current);
          }
        });
        ref.current = marker;
      } else {
        ref.current.setLngLat(lngLat);
      }
    },
    [requestRoute],
  );

  const setStart = useCallback(
    (p: LatLon) => {
      startPt.current = p;
      setStartText(fmt(p));
      placeMarker("start", p);
      setStatus("start-set");
      setProps(null);
      setErrorMsg("");
    },
    [placeMarker],
  );

  const setEnd = useCallback(
    (p: LatLon) => {
      endPt.current = p;
      setEndText(fmt(p));
      placeMarker("end", p);
    },
    [placeMarker],
  );

  const reset = useCallback(() => {
    startMarker.current?.remove();
    endMarker.current?.remove();
    startMarker.current = null;
    endMarker.current = null;
    startPt.current = null;
    endPt.current = null;
    clearRouteLine();
    setStartText("");
    setEndText("");
    setProps(null);
    setErrorMsg("");
    setStatus("idle");
  }, [clearRouteLine]);

  const onMapClick = useCallback(
    (lngLat: maplibregl.LngLat) => {
      const p: LatLon = { lat: lngLat.lat, lon: lngLat.lng };
      if (!startPt.current) {
        setStart(p);
      } else if (!endPt.current) {
        setEnd(p);
        void requestRoute(startPt.current, p);
      } else {
        // Both already set: start a fresh route from this click.
        endMarker.current?.remove();
        endMarker.current = null;
        endPt.current = null;
        clearRouteLine();
        setStart(p);
      }
    },
    [setStart, setEnd, requestRoute, clearRouteLine],
  );

  // Form submit: use the two text inputs as a non-map alternative.
  const onSubmitForm = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const from = parseLatLon(startText);
      const to = parseLatLon(endText);
      if (!from || !to) {
        setStatus("error");
        setErrorMsg('Enter both points as "lat, lon", e.g. 50.0617, 19.9373.');
        return;
      }
      setStart(from);
      setEnd(to);
      const map = mapRef.current;
      if (map) {
        map.setCenter([from.lon, from.lat]);
      }
      void requestRoute(from, to);
    },
    [startText, endText, setStart, setEnd, requestRoute],
  );

  useEffect(() => {
    if (mapRef.current || !mapContainer.current) return;
    reduceMotion.current =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Load MapLibre's worker from a stable public URL. Bundlers don't reliably
    // emit MapLibre's import.meta.url worker chunk, which would 404 and leave the
    // map blank. The file is copied into public/maplibre/ by the predev/prebuild
    // script; it imports ./maplibre-gl-shared.mjs from the same folder.
    maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: MAP_STYLE,
      center: KRAKOW_CENTER,
      zoom: 13,
      attributionControl: false,
    });
    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
    // ODbL requires visible OpenStreetMap attribution; keep it expanded.
    map.addControl(
      new maplibregl.AttributionControl({
        compact: false,
        customAttribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }),
    );

    map.on("load", () => {
      mapReady.current = true;
      map.addSource(ROUTE_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "route-casing",
        type: "line",
        source: ROUTE_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": 8, "line-opacity": 0.9 },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: ROUTE_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#0b5cad", "line-width": 4 },
      });

      // If a route was requested while tiles were still loading, draw it now.
      if (pendingFeature.current) {
        const f = pendingFeature.current;
        pendingFeature.current = null;
        drawRoute(f);
      }
    });

    map.on("click", (e) => onMapClick(e.lngLat));

    return () => {
      map.remove();
      mapRef.current = null;
      mapReady.current = false;
    };
    // onMapClick is stable via refs; intentionally run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const liveMessage =
    status === "error"
      ? errorMsg
      : status === "loading"
        ? "Finding a route…"
        : status === "route-ready" && props
          ? props.summary
          : status === "start-set"
            ? "Start point A set. Click the map again, or fill in the destination, to get a route."
            : "Click the map to set your start point (A).";

  return (
    <main className={styles.shell}>
      <div ref={mapContainer} className={styles.map} role="application" aria-label="Map of Kraków" />

      <section className={styles.panel} aria-label="Route planner">
        <h1 className={styles.title}>Kraków walking routes</h1>
        <p className={styles.hint}>
          Click two points on the map, or type coordinates below. Markers A and B
          can be dragged to update the route.
        </p>

        <div className={styles.status} aria-live="polite" role="status">
          {status === "error" ? (
            <span className={styles.error}>{liveMessage}</span>
          ) : status === "route-ready" && props ? (
            <span className={styles.summary}>{liveMessage}</span>
          ) : (
            <span>{liveMessage}</span>
          )}
        </div>

        {status === "route-ready" && props && (
          <p className={styles.meta}>
            {props.length_m.toLocaleString()} m · ~{props.duration_min_estimate} min ·{" "}
            {props.edge_count} segments · profile “{props.profile}”
          </p>
        )}

        <form className={styles.form} onSubmit={onSubmitForm}>
          <div>
            <label htmlFor="start-input">Start (lat, lon)</label>
            <input
              id="start-input"
              type="text"
              inputMode="decimal"
              placeholder="50.0617, 19.9373"
              value={startText}
              onChange={(e) => setStartText(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="end-input">Destination (lat, lon)</label>
            <input
              id="end-input"
              type="text"
              inputMode="decimal"
              placeholder="50.0540, 19.9353"
              value={endText}
              onChange={(e) => setEndText(e.target.value)}
            />
          </div>
          <div className={styles.row}>
            <button type="submit">Get route</button>
            <button type="button" className="secondary" onClick={reset}>
              Reset
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
