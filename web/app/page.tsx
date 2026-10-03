"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  getHealth,
  getRoute,
  RouteRequestError,
  type LatLon,
  type LightMode,
  type RouteFeature,
  type RouteProperties,
  type Strength,
} from "@/lib/api";
import styles from "./page.module.css";

const MAP_STYLE =
  process.env.NEXT_PUBLIC_MAP_STYLE_URL ??
  "https://tiles.openfreemap.org/styles/liberty";
const KRAKOW_CENTER: [number, number] = [19.94, 50.06];
const ROUTE_SOURCE = "route";
const UNCERTAIN_SOURCE = "route-uncertain";

type Status = "idle" | "start-set" | "loading" | "route-ready" | "error";

interface SensoryOpts {
  noise: boolean;
  light: LightMode | null;
  crowd: boolean;
  strength: Strength;
}

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
  el.setAttribute("aria-hidden", "true");
  const span = document.createElement("span");
  span.textContent = label;
  el.appendChild(span);
  return el;
}

function emptyFC(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

export default function Page() {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const startMarker = useRef<maplibregl.Marker | null>(null);
  const endMarker = useRef<maplibregl.Marker | null>(null);
  const startPt = useRef<LatLon | null>(null);
  const endPt = useRef<LatLon | null>(null);
  const reduceMotion = useRef(false);
  const pendingFeature = useRef<RouteFeature | null>(null);

  const [status, setStatus] = useState<Status>("idle");
  const [props, setProps] = useState<RouteProperties | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [startText, setStartText] = useState("");
  const [endText, setEndText] = useState("");

  // Sensory selection. A ref mirror lets the stable map-click handler read current values.
  const [noise, setNoise] = useState(false);
  const [light, setLight] = useState<LightMode | null>(null);
  const [crowd, setCrowd] = useState(false);
  const [strength, setStrength] = useState<Strength>("medium");
  const optsRef = useRef<SensoryOpts>({ noise, light, crowd, strength });

  // Which factors the backend data supports (crowds needs a BestTime key).
  const [avail, setAvail] = useState({ noise: true, light: true, crowd: false });

  const drawRoute = useCallback((feature: RouteFeature) => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource(ROUTE_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!src) {
      pendingFeature.current = feature; // style not ready yet; draw on 'load'
      return;
    }
    src.setData(feature as unknown as GeoJSON.Feature);

    const unc = map.getSource(UNCERTAIN_SOURCE) as maplibregl.GeoJSONSource | undefined;
    unc?.setData({
      type: "FeatureCollection",
      features: feature.uncertain_segments.map((coords) => ({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: coords },
      })),
    } as GeoJSON.FeatureCollection);

    const coords = feature.geometry.coordinates;
    const bounds = coords.reduce(
      (b, c) => b.extend(c as [number, number]),
      new maplibregl.LngLatBounds(coords[0] as [number, number], coords[0] as [number, number]),
    );
    const narrow = window.innerWidth < 520;
    const padding = narrow
      ? { top: 40, bottom: Math.round(window.innerHeight * 0.5), left: 30, right: 30 }
      : { top: 60, bottom: 60, left: 360, right: 60 };
    map.fitBounds(bounds, { padding, animate: !reduceMotion.current });
  }, []);

  const clearRouteLine = useCallback(() => {
    const map = mapRef.current;
    (map?.getSource(ROUTE_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(emptyFC());
    (map?.getSource(UNCERTAIN_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(emptyFC());
  }, []);

  const requestRoute = useCallback(
    async (from: LatLon, to: LatLon) => {
      setStatus("loading");
      setErrorMsg("");
      try {
        const feature = await getRoute(from, to, optsRef.current);
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
          if (startPt.current && endPt.current) void requestRoute(startPt.current, endPt.current);
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
        endMarker.current?.remove();
        endMarker.current = null;
        endPt.current = null;
        clearRouteLine();
        setStart(p);
      }
    },
    [setStart, setEnd, requestRoute, clearRouteLine],
  );

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
      mapRef.current?.setCenter([from.lon, from.lat]);
      void requestRoute(from, to);
    },
    [startText, endText, setStart, setEnd, requestRoute],
  );

  // Keep the opts ref in sync and re-route when the user changes their selection.
  useEffect(() => {
    optsRef.current = { noise, light, crowd, strength };
    if (startPt.current && endPt.current) void requestRoute(startPt.current, endPt.current);
  }, [noise, light, crowd, strength, requestRoute]);

  // Ask the API which factors are available (e.g. crowds only with a key).
  useEffect(() => {
    getHealth()
      .then((h) => setAvail(h.factors))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (mapRef.current || !mapContainer.current) return;
    reduceMotion.current =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
    map.addControl(
      new maplibregl.AttributionControl({
        compact: false,
        customAttribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }),
    );

    map.on("load", () => {
      map.addSource(ROUTE_SOURCE, { type: "geojson", data: emptyFC() });
      map.addSource(UNCERTAIN_SOURCE, { type: "geojson", data: emptyFC() });
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
      // Uncertain-data overlay: dashed so it reads without relying on colour alone.
      map.addLayer({
        id: "route-uncertain-line",
        type: "line",
        source: UNCERTAIN_SOURCE,
        layout: { "line-cap": "butt", "line-join": "round" },
        paint: { "line-color": "#d98a00", "line-width": 4, "line-dasharray": [2, 2] },
      });

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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const anyActive = noise || crowd || light !== null;
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

  const noiseExp = props?.exposure?.noise;
  const lightExp = props?.exposure?.light;
  const crowdExp = props?.exposure?.crowd;
  const noiseUnc = props?.uncertainty?.noise;
  const lightUnc = props?.uncertainty?.light;
  const crowdUnc = props?.uncertainty?.crowd;

  return (
    <main className={styles.shell}>
      <div ref={mapContainer} className={styles.map} role="application" aria-label="Map of Kraków" />

      <section className={styles.panel} aria-label="Route planner">
        <h1 className={styles.title}>Kraków walking routes</h1>
        <p className={styles.hint}>
          Click two points on the map, or type coordinates below. Pick what affects
          you and we route around it — dashed parts are where we lack data.
        </p>

        <fieldset className={styles.factors}>
          <legend>What should we route around?</legend>
          <label className={styles.check}>
            <input type="checkbox" checked={noise} onChange={(e) => setNoise(e.target.checked)} />
            Avoid noisy streets
          </label>

          {avail.crowd && (
            <label className={styles.check}>
              <input type="checkbox" checked={crowd} onChange={(e) => setCrowd(e.target.checked)} />
              Avoid busy areas (typical for now)
            </label>
          )}

          <div className={styles.subgroup} role="radiogroup" aria-label="Lighting preference">
            <span className={styles.subLabel}>Lighting</span>
            <label className={styles.radio}>
              <input type="radio" name="light" checked={light === null} onChange={() => setLight(null)} />
              No preference
            </label>
            <label className={styles.radio}>
              <input type="radio" name="light" checked={light === "prefer_lit"} onChange={() => setLight("prefer_lit")} />
              Prefer well-lit (e.g. at night)
            </label>
            <label className={styles.radio}>
              <input type="radio" name="light" checked={light === "avoid_bright"} onChange={() => setLight("avoid_bright")} />
              Avoid bright areas
            </label>
          </div>

          {anyActive && (
            <div className={styles.subgroup}>
              <label className={styles.subLabel} htmlFor="strength">How strongly</label>
              <select
                id="strength"
                value={strength}
                onChange={(e) => setStrength(e.target.value as Strength)}
                className={styles.select}
              >
                <option value="low">A little</option>
                <option value="medium">Moderate</option>
                <option value="high">A lot</option>
              </select>
            </div>
          )}
        </fieldset>

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
          <>
            <p className={styles.meta}>
              {props.length_m.toLocaleString()} m · ~{props.duration_min_estimate} min ·{" "}
              {props.edge_count} segments
            </p>
            {(noiseExp || lightExp || crowdExp) && (
              <ul className={styles.factorStats}>
                {noiseExp && (
                  <li>
                    <strong>Noise:</strong>{" "}
                    {noiseExp.mean_lden_db != null ? `avg ${noiseExp.mean_lden_db} dB, ` : ""}
                    {noiseExp.loud_pct}% loud
                    {noiseUnc && noiseUnc.unknown_pct > 0
                      ? ` · ${noiseUnc.unknown_pct}% unknown`
                      : " · data known"}
                  </li>
                )}
                {lightExp && (
                  <li>
                    <strong>Lighting:</strong> {lightExp.lit_pct}% well-lit
                    {lightUnc && lightUnc.unknown_pct > 0
                      ? ` · ${lightUnc.unknown_pct}% unknown (dashed)`
                      : ""}
                  </li>
                )}
                {crowdExp && (
                  <li>
                    <strong>Busy areas:</strong> {crowdExp.busy_pct}% usually busy now
                    {crowdUnc && crowdUnc.unknown_pct > 0
                      ? ` · ${crowdUnc.unknown_pct}% no data (dashed)`
                      : ""}
                  </li>
                )}
              </ul>
            )}
          </>
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
