"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import {
  getHealth,
  getRoute,
  RouteRequestError,
  type LatLon,
  type LightMode,
  type RouteFeature,
} from "@/lib/api";
import { buildFactorViews, routeName, type FactorView } from "@/lib/factors";
import {
  applySettings,
  DEFAULT_SETTINGS,
  loadSettings,
  motionReduced,
  saveSettings,
  type Settings,
} from "@/lib/settings";
import Sheet from "@/components/Sheet";
import SettingsSheet from "@/components/SettingsSheet";
import HelpSheet from "@/components/HelpSheet";
import LegendSheet from "@/components/LegendSheet";
import OverwhelmFlow from "@/components/OverwhelmFlow";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  GearIcon,
  HeartPulseIcon,
  HelpIcon,
  InfoIcon,
  LayersIcon,
  LegendIcon,
  LocateIcon,
  MinusIcon,
  PlusIcon,
  SwapIcon,
  WarningIcon,
} from "@/components/icons";
import styles from "./page.module.css";

const MAP_STYLE =
  process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/liberty";
const KRAKOW_CENTER: [number, number] = [19.9372, 50.0614];
const ROUTE_SRC = "route";
const ALT_SRC = "route-alt";
const UNC_SRC = "route-uncertain";
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Status = "idle" | "picking" | "loading" | "ready" | "error";
type RouteId = "best" | "shortest";

interface Routes {
  best: RouteFeature | null;
  shortest: RouteFeature | null;
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

function cssVar(name: string): string {
  if (typeof window === "undefined") return "#000";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#000";
}

// Start is a circle, destination a teardrop pin — distinct shapes so the two are
// told apart without colour (COL-04). The text fields carry the names for AT.
function endpointEl(kind: "start" | "end"): HTMLDivElement {
  const el = document.createElement("div");
  el.className = `route-marker ${kind}`;
  el.setAttribute("aria-hidden", "true");
  return el;
}

function qMarkerEl(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "nodata-marker";
  el.setAttribute("aria-hidden", "true");
  el.textContent = "?";
  return el;
}

function emptyFC(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

// Kraków-local day (0=Mon..6=Sun) and hour from a datetime-local value.
function dayHour(value: string): { day: number; hour: number } | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return { day: (d.getDay() + 6) % 7, hour: d.getHours() };
}

export default function Page() {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const startMarker = useRef<maplibregl.Marker | null>(null);
  const endMarker = useRef<maplibregl.Marker | null>(null);
  const qMarkers = useRef<maplibregl.Marker[]>([]);
  const startPt = useRef<LatLon | null>(null);
  const endPt = useRef<LatLon | null>(null);
  const fittedKey = useRef<string>("");

  // ---- Settings (persisted on device) ----
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const patchSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      applySettings(next);
      return next;
    });
  }, []);

  // ---- Trip inputs ----
  const [startText, setStartText] = useState("");
  const [endText, setEndText] = useState("");
  const [whenMode, setWhenMode] = useState<"now" | "leave">("now");
  const [leaveAt, setLeaveAt] = useState("");

  // ---- Profile (this trip) ----
  const [noise, setNoise] = useState(false);
  const [light, setLight] = useState<LightMode | null>(null);
  const [crowd, setCrowd] = useState(false);
  const [dirty, setDirty] = useState(false); // profile changed from the saved default

  // ---- Results ----
  const [routes, setRoutes] = useState<Routes>({ best: null, shortest: null });
  const [selected, setSelected] = useState<RouteId>("best");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  // ---- UI chrome ----
  const [expanded, setExpanded] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [sheetOpen, setSheetOpen] = useState<"settings" | "help" | "legend" | "adjust" | null>(null);
  const [overwhelm, setOverwhelm] = useState(false);
  const [walkNote, setWalkNote] = useState("");
  const [avail, setAvail] = useState({ noise: true, light: true, crowd: false });

  // Trigger refs so sheets can return focus (LAY-06).
  const settingsBtn = useRef<HTMLButtonElement | null>(null);
  const helpBtn = useRef<HTMLButtonElement | null>(null);
  const legendBtn = useRef<HTMLButtonElement | null>(null);
  const adjustBtn = useRef<HTMLButtonElement | null>(null);
  const overwhelmBtn = useRef<HTMLButtonElement | null>(null);

  // Mirror live trip inputs so the stable map-click handler reads current values.
  const opts = useRef({ noise, light, crowd, settings, whenMode, leaveAt });
  useEffect(() => {
    opts.current = { noise, light, crowd, settings, whenMode, leaveAt };
  });

  const active = noise || crowd || light !== null;

  // ----- Apply saved settings + default profile on mount (reads localStorage,
  // so it must run on the client after mount — a legitimate external sync). -----
  useEffect(() => {
    const s = loadSettings();
    applySettings(s);
    /* eslint-disable react-hooks/set-state-in-effect */
    setSettings(s);
    setNoise(s.profile.noise);
    setLight(s.profile.light);
    setCrowd(s.profile.crowd);
    /* eslint-enable react-hooks/set-state-in-effect */
    getHealth()
      .then((h) => setAvail(h.factors))
      .catch(() => {});
  }, []);

  // ----- Map drawing -----
  const drawSelected = useCallback(() => {
    const map = mapRef.current;
    if (!map || !map.getSource(ROUTE_SRC)) return;
    const o = opts.current;
    const sel = selected === "best" && routes.best ? routes.best : routes.shortest;
    const other = sel === routes.best ? routes.shortest : routes.best; // the unselected route, if any

    const main = map.getSource(ROUTE_SRC) as maplibregl.GeoJSONSource;
    const altSrc = map.getSource(ALT_SRC) as maplibregl.GeoJSONSource;
    const uncSrc = map.getSource(UNC_SRC) as maplibregl.GeoJSONSource;

    main.setData((sel ?? emptyFC()) as unknown as GeoJSON.Feature);
    altSrc.setData((other ?? emptyFC()) as unknown as GeoJSON.Feature);

    // Colour the selected line by which route it is (letter + colour, COL-06).
    const isBest = sel === routes.best && routes.best != null;
    map.setPaintProperty(
      "route-line",
      "line-color",
      isBest ? cssVar("--route-quiet") : cssVar("--route-shortest"),
    );

    // No-data overlay (dashed) for the selected route.
    uncSrc.setData({
      type: "FeatureCollection",
      features: (sel?.uncertain_segments ?? []).map((coords) => ({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: coords },
      })),
    } as GeoJSON.FeatureCollection);

    // "?" markers at the midpoint of each no-data stretch (UNC-02 fourth cue).
    qMarkers.current.forEach((m) => m.remove());
    qMarkers.current = [];
    for (const seg of sel?.uncertain_segments ?? []) {
      if (seg.length === 0) continue;
      const mid = seg[Math.floor(seg.length / 2)] as [number, number];
      qMarkers.current.push(new maplibregl.Marker({ element: qMarkerEl() }).setLngLat(mid).addTo(map));
    }

    // Fit once per new result set (MOT-04): instant under reduced motion.
    if (sel) {
      const key = `${selected}:${sel.geometry.coordinates.length}:${sel.geometry.coordinates[0]?.join(",")}`;
      if (key !== fittedKey.current) {
        fittedKey.current = key;
        const coords = sel.geometry.coordinates;
        const b = coords.reduce(
          (acc, c) => acc.extend(c as [number, number]),
          new maplibregl.LngLatBounds(coords[0] as [number, number], coords[0] as [number, number]),
        );
        map.fitBounds(b, {
          padding: { top: 50, bottom: 50, left: 40, right: 40 },
          animate: !motionReduced(o.settings),
          duration: 200,
        });
      }
    }
  }, [routes, selected]);

  useEffect(() => {
    drawSelected();
  }, [drawSelected]);

  // ----- Routing -----
  const requestRoutes = useCallback(
    async (from: LatLon, to: LatLon) => {
      const o = opts.current;
      const act = o.noise || o.crowd || o.light !== null;
      const strength = o.settings.strictness === "strict" ? "high" : "medium";
      const when = o.whenMode === "leave" ? dayHour(o.leaveAt) : null;
      setStatus("loading");
      setErrorMsg("");
      try {
        if (!act) {
          const shortest = await getRoute(from, to, {});
          setRoutes({ best: null, shortest });
          setSelected("shortest");
        } else {
          const common = {
            noise: o.noise,
            light: o.light,
            crowd: o.crowd,
            whenDay: when?.day ?? null,
            whenHour: when?.hour ?? null,
          };
          const [best, shortest] = await Promise.all([
            getRoute(from, to, { ...common, strength }),
            getRoute(from, to, { ...common, strength: "off" }),
          ]);
          setRoutes({ best, shortest });
          setSelected("best");
        }
        fittedKey.current = ""; // force a fresh fit
        setStatus("ready");
      } catch (err) {
        setRoutes({ best: null, shortest: null });
        setStatus("error");
        setErrorMsg(
          err instanceof RouteRequestError
            ? err.message
            : "Something went wrong finding a route.",
        );
      }
    },
    [],
  );

  const setEndpoint = useCallback((which: "start" | "end", p: LatLon) => {
    const map = mapRef.current;
    const ref = which === "start" ? startMarker : endMarker;
    (which === "start" ? startPt : endPt).current = p;
    if (which === "start") setStartText(fmt(p));
    else setEndText(fmt(p));
    const lngLat: [number, number] = [p.lon, p.lat];
    if (map) {
      if (!ref.current) {
        const m = new maplibregl.Marker({ element: endpointEl(which), draggable: true, anchor: "bottom" })
          .setLngLat(lngLat)
          .addTo(map);
        m.on("dragend", () => {
          const ll = m.getLngLat();
          const np = { lat: ll.lat, lon: ll.lng };
          (which === "start" ? startPt : endPt).current = np;
          if (which === "start") setStartText(fmt(np));
          else setEndText(fmt(np));
          if (startPt.current && endPt.current) void requestRoutes(startPt.current, endPt.current);
        });
        ref.current = m;
      } else {
        ref.current.setLngLat(lngLat);
      }
    }
  }, [requestRoutes]);

  const onMapClick = useCallback(
    (lngLat: maplibregl.LngLat) => {
      const p: LatLon = { lat: lngLat.lat, lon: lngLat.lng };
      if (!startPt.current) {
        setEndpoint("start", p);
        setStatus("picking");
      } else if (!endPt.current) {
        setEndpoint("end", p);
        void requestRoutes(startPt.current, p);
      } else {
        endMarker.current?.remove();
        endMarker.current = null;
        endPt.current = null;
        setEndText("");
        setEndpoint("start", p);
        setStatus("picking");
      }
    },
    [setEndpoint, requestRoutes],
  );

  // Re-route when the profile / time changes and we already have both endpoints.
  useEffect(() => {
    if (startPt.current && endPt.current) void requestRoutes(startPt.current, endPt.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noise, light, crowd, whenMode, leaveAt, settings.strictness]);

  // ----- Map init -----
  useEffect(() => {
    if (mapRef.current || !mapContainer.current) return;
    maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: MAP_STYLE,
      center: KRAKOW_CENTER,
      zoom: 13,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(
      new maplibregl.AttributionControl({
        compact: false,
        customAttribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }),
    );

    map.on("load", () => {
      map.addSource(ALT_SRC, { type: "geojson", data: emptyFC() });
      map.addSource(ROUTE_SRC, { type: "geojson", data: emptyFC() });
      map.addSource(UNC_SRC, { type: "geojson", data: emptyFC() });

      // Unselected route: thin, muted (MAP-06).
      map.addLayer({
        id: "route-alt-line",
        type: "line",
        source: ALT_SRC,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": cssVar("--route-shortest"), "line-width": 3, "line-opacity": 0.8 },
      });
      // Selected route: casing + line (casing gives 3:1 vs tiles, COL-10).
      map.addLayer({
        id: "route-casing",
        type: "line",
        source: ROUTE_SRC,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": cssVar("--route-casing"), "line-width": 8 },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: ROUTE_SRC,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": cssVar("--route-quiet"), "line-width": 5 },
      });
      // No-data overlay: static dashes (MOT-05) in the no-data token.
      map.addLayer({
        id: "route-uncertain-line",
        type: "line",
        source: UNC_SRC,
        layout: { "line-cap": "butt", "line-join": "round" },
        paint: { "line-color": cssVar("--no-data"), "line-width": 5, "line-dasharray": [2, 2] },
      });
      drawSelected();
    });

    map.on("click", (e) => onMapClick(e.lngLat));
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-skin lines when the theme token changes.
  useEffect(() => {
    const map = mapRef.current;
    if (map?.getLayer("route-uncertain-line")) {
      map.setPaintProperty("route-uncertain-line", "line-color", cssVar("--no-data"));
      map.setPaintProperty("route-casing", "line-color", cssVar("--route-casing"));
      map.setPaintProperty("route-alt-line", "line-color", cssVar("--route-shortest"));
      drawSelected();
    }
  }, [settings.theme, drawSelected]);

  // ----- Controls -----
  const zoom = (dir: 1 | -1) =>
    mapRef.current?.[dir === 1 ? "zoomIn" : "zoomOut"]({ animate: !motionReduced(settings) });

  const locate = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setEndpoint("start", p);
        setStatus("picking");
        mapRef.current?.easeTo({
          center: [p.lon, p.lat],
          zoom: 15,
          animate: !motionReduced(settings),
        });
      },
      () => setErrorMsg("Location is off. Enter a start point, or turn on location."),
    );
  };

  const swap = () => {
    const s = startPt.current;
    const e = endPt.current;
    startPt.current = e;
    endPt.current = s;
    setStartText(e ? fmt(e) : "");
    setEndText(s ? fmt(s) : "");
    if (e) setEndpoint("start", e);
    if (s) setEndpoint("end", s);
    if (startPt.current && endPt.current) void requestRoutes(startPt.current, endPt.current);
  };

  const onSubmit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const from = parseLatLon(startText);
    const to = parseLatLon(endText);
    if (!from || !to) {
      setStatus("error");
      setErrorMsg('Enter both points as "lat, lon", for example 50.0617, 19.9373.');
      return;
    }
    setEndpoint("start", from);
    setEndpoint("end", to);
    void requestRoutes(from, to);
  };

  const changeProfile = (fn: () => void) => {
    fn();
    setDirty(true);
  };
  const saveDefault = () => {
    patchSettings({ profile: { noise, light, crowd } });
    setDirty(false);
  };

  const reset = () => {
    startMarker.current?.remove();
    endMarker.current?.remove();
    startMarker.current = null;
    endMarker.current = null;
    startPt.current = null;
    endPt.current = null;
    setStartText("");
    setEndText("");
    setRoutes({ best: null, shortest: null });
    setStatus("idle");
    setErrorMsg("");
    fittedKey.current = "";
    drawSelected();
  };

  const deleteData = () => {
    if (typeof window !== "undefined") window.localStorage.removeItem("krk.settings");
    const d = { ...DEFAULT_SETTINGS };
    setSettings(d);
    applySettings(d);
    setNoise(false);
    setLight(null);
    setCrowd(false);
    setSheetOpen(null);
  };

  // ----- Derived: time label + cards -----
  const timeLabel = useMemo(() => {
    const dh = whenMode === "leave" ? dayHour(leaveAt) : null;
    if (!dh) return "typical for now"; // no valid "leave at" time -> data is for now
    return `typical for ${DAY_NAMES[dh.day]} ${String(dh.hour).padStart(2, "0")}:00`;
  }, [whenMode, leaveAt]);

  const activeSel = { noise, light, crowd };

  interface CardModel {
    id: RouteId;
    letter: string;
    cls: string;
    name: string;
    feature: RouteFeature;
    minutes: number;
    lengthM: number;
    extraMin: number;
    factors: FactorView[];
    gaps: boolean;
  }

  const cards: CardModel[] = useMemo(() => {
    const out: CardModel[] = [];
    const shortMin = routes.shortest?.properties.duration_min_estimate ?? null;
    if (routes.best) {
      const f = buildFactorViews(routes.best.properties, activeSel, timeLabel);
      out.push({
        id: "best",
        letter: "A",
        cls: styles.a,
        name: routeName(activeSel),
        feature: routes.best,
        minutes: routes.best.properties.duration_min_estimate,
        lengthM: routes.best.properties.length_m,
        extraMin: shortMin != null ? routes.best.properties.duration_min_estimate - shortMin : 0,
        factors: f,
        gaps: f.some((v) => v.noDataPct > 0 || v.levelWord === null),
      });
    }
    if (routes.shortest) {
      const f = active ? buildFactorViews(routes.shortest.properties, activeSel, timeLabel) : [];
      out.push({
        id: "shortest",
        letter: "S",
        cls: styles.s,
        name: "Shortest",
        feature: routes.shortest,
        minutes: routes.shortest.properties.duration_min_estimate,
        lengthM: routes.shortest.properties.length_m,
        extraMin: 0,
        factors: f,
        gaps: f.some((v) => v.noDataPct > 0 || v.levelWord === null),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes, timeLabel, noise, light, crowd]);

  const selCard = cards.find((c) => c.id === selected) ?? cards[0];
  const noDataStretches = selCard?.feature.uncertain_segments.length ?? 0;

  // Status line copy (AT-02 live region).
  const statusText =
    status === "error"
      ? errorMsg
      : status === "loading"
        ? "Finding routes"
        : status === "ready"
          ? `${cards.length} route${cards.length === 1 ? "" : "s"} found`
          : status === "picking"
            ? "Start set. Tap the map for your destination, or type it above."
            : "Tap the map to set your start, or type two points above.";

  const flyToSegment = (coords: [number, number][]) => {
    const map = mapRef.current;
    if (!map || coords.length === 0) return;
    const b = coords.reduce(
      (acc, c) => acc.extend(c),
      new maplibregl.LngLatBounds(coords[0], coords[0]),
    );
    map.fitBounds(b, { padding: 80, maxZoom: 16, animate: !motionReduced(settings) });
  };

  return (
    <div className={styles.shell}>
      <a className="skip-link" href="#routes">Skip to routes</a>

      {/* ---- Top bar ---- */}
      <header className={styles.topbar}>
        <div className={styles.fields}>
          <div className={styles.field}>
            <label htmlFor="start-input">Start</label>
            <input
              id="start-input"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="Your location or lat, lon"
              value={startText}
              onChange={(e) => setStartText(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="end-input">Destination</label>
            <input
              id="end-input"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="Tap the map or type lat, lon"
              value={endText}
              onChange={(e) => setEndText(e.target.value)}
            />
          </div>
        </div>
        <div className={styles.topActions}>
          <button
            ref={settingsBtn}
            type="button"
            className={`${styles.mapBtn} ${styles.mapBtnWide}`}
            onClick={() => setSheetOpen("settings")}
          >
            <GearIcon />
            Settings
          </button>
          <button
            ref={helpBtn}
            type="button"
            className={`${styles.mapBtn} ${styles.mapBtnWide}`}
            onClick={() => setSheetOpen("help")}
          >
            <HelpIcon />
            Help
          </button>
        </div>
        <div className={styles.swapRow}>
          <button type="button" className={styles.btn} onClick={swap}>
            <SwapIcon />
            Swap start and destination
          </button>
        </div>
      </header>

      {/* ---- When row ---- */}
      <div className={styles.whenRow}>
        <span className={styles.whenLabel} id="when-label">When</span>
        <span className={styles.segmented} role="radiogroup" aria-labelledby="when-label">
          <button
            type="button"
            aria-pressed={whenMode === "now"}
            onClick={() => setWhenMode("now")}
          >
            {whenMode === "now" && <CheckIcon className={styles.check} />}
            Now
          </button>
          <button
            type="button"
            aria-pressed={whenMode === "leave"}
            onClick={() => setWhenMode("leave")}
          >
            {whenMode === "leave" && <CheckIcon className={styles.check} />}
            Leave at
          </button>
        </span>
        {whenMode === "leave" && (
          <input
            type="datetime-local"
            className={styles.btn}
            aria-label="Leave at time"
            value={leaveAt}
            onChange={(e) => setLeaveAt(e.target.value)}
            style={{ padding: "0 0.5rem" }}
          />
        )}
      </div>

      {/* ---- Map ---- */}
      <div className={styles.mapWrap}>
        <div
          ref={mapContainer}
          className={styles.map}
          role="application"
          aria-label="Map of Kraków. Tap to set start and destination."
        />

        <div className={`${styles.mapControls} ${styles.right}`}>
          <button type="button" className={styles.mapBtn} onClick={() => zoom(1)} aria-label="Zoom in">
            <PlusIcon />
          </button>
          <button type="button" className={styles.mapBtn} onClick={() => zoom(-1)} aria-label="Zoom out">
            <MinusIcon />
          </button>
        </div>
        <div className={`${styles.mapControls} ${styles.locate}`}>
          <button type="button" className={styles.mapBtn} onClick={locate} aria-label="Use my location">
            <LocateIcon />
          </button>
        </div>
        <div className={`${styles.mapControls} ${styles.left}`}>
          <button
            ref={legendBtn}
            type="button"
            className={`${styles.mapBtn} ${styles.mapBtnWide}`}
            onClick={() => setSheetOpen("legend")}
          >
            <LegendIcon />
            Legend
          </button>
          <button
            type="button"
            className={`${styles.mapBtn} ${styles.mapBtnWide}`}
            aria-pressed={true}
            aria-label="Layers: no-data stretches shown"
            title="No-data stretches are shown"
          >
            <LayersIcon />
            Layers
          </button>
        </div>

        <div className={styles.overwhelmWrap}>
          <button
            ref={overwhelmBtn}
            type="button"
            className={styles.overwhelm}
            onClick={() => setOverwhelm(true)}
          >
            <HeartPulseIcon />
            I don&apos;t feel well
          </button>
        </div>
      </div>

      {/* ---- Bottom sheet ---- */}
      <section className={styles.sheet} aria-label="Plan a walk" id="routes">
        <div className={styles.sheetHandle}>
          <h1 className={styles.sheetTitle}>Plan a walk</h1>
          <button
            type="button"
            className={styles.btn}
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            {expanded ? <ChevronDownIcon /> : <ChevronUpIcon />}
            {expanded ? "Collapse" : "Expand"}
          </button>
        </div>

        <div className={styles.sheetBody} style={{ maxHeight: expanded ? "72dvh" : "42dvh" }}>
          <div className={styles.sheetInner}>
            {/* Profile row */}
            <div className={styles.profileRow}>
              <button
                type="button"
                className={styles.toggle}
                aria-pressed={noise}
                onClick={() => changeProfile(() => setNoise((v) => !v))}
              >
                {noise && <CheckIcon className={styles.check} />}
                Noise
              </button>

              {avail.crowd && (
                <button
                  type="button"
                  className={styles.toggle}
                  aria-pressed={crowd}
                  onClick={() => changeProfile(() => setCrowd((v) => !v))}
                >
                  {crowd && <CheckIcon className={styles.check} />}
                  Crowds
                </button>
              )}

              <span className={styles.segmented} role="radiogroup" aria-label="Light preference">
                <button
                  type="button"
                  aria-pressed={light === "avoid_bright"}
                  onClick={() => changeProfile(() => setLight((v) => (v === "avoid_bright" ? null : "avoid_bright")))}
                >
                  Avoid bright
                </button>
                <button
                  type="button"
                  aria-pressed={light === null}
                  onClick={() => changeProfile(() => setLight(null))}
                >
                  No light pref.
                </button>
                <button
                  type="button"
                  aria-pressed={light === "prefer_lit"}
                  onClick={() => changeProfile(() => setLight((v) => (v === "prefer_lit" ? null : "prefer_lit")))}
                >
                  Prefer well-lit
                </button>
              </span>

              <button
                ref={adjustBtn}
                type="button"
                className={styles.toggle}
                onClick={() => setSheetOpen("adjust")}
              >
                <GearIcon className={styles.check} />
                Adjust
              </button>
            </div>

            {dirty && (
              <button type="button" className={styles.btnGhost + " " + styles.btn} onClick={saveDefault} style={{ marginBottom: "0.5rem" }}>
                Save as my default
              </button>
            )}

            {/* Status (live) */}
            <p className={styles.status} aria-live="polite" role="status">
              {status === "error" ? (
                <span className={styles.statusError}>
                  <WarningIcon />
                  {statusText}
                </span>
              ) : (
                statusText
              )}
            </p>

            {!active && status === "ready" && (
              <p className={styles.hint}>No preferences on, so routes are ranked by distance.</p>
            )}

            {/* Compare toggle */}
            {cards.length > 1 && (
              <div className={styles.compareRow}>
                <button
                  type="button"
                  className={styles.btn}
                  aria-pressed={showCompare}
                  onClick={() => setShowCompare((v) => !v)}
                >
                  {showCompare ? "Hide compare" : "Compare"}
                </button>
              </div>
            )}

            {/* Compare table (F3) */}
            {showCompare && cards.length > 1 && (
              <div className={styles.tableWrap}>
                <table className={styles.compareTable}>
                  <thead>
                    <tr>
                      <th scope="col">Route</th>
                      <th scope="col">Time</th>
                      <th scope="col">Extra</th>
                      {active && noise && <th scope="col">Noise</th>}
                      {active && light !== null && <th scope="col">Light</th>}
                      {active && crowd && <th scope="col">Crowds</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {cards.map((c) => (
                      <tr key={c.id}>
                        <th scope="row">{c.name}</th>
                        <td>{c.minutes} min</td>
                        <td>{c.extraMin > 0 ? `+${c.extraMin} min` : "—"}</td>
                        {active && noise && <td>{c.factors.find((f) => f.key === "noise")?.text ?? "—"}</td>}
                        {active && light !== null && <td>{c.factors.find((f) => f.key === "light")?.text ?? "—"}</td>}
                        {active && crowd && <td>{c.factors.find((f) => f.key === "crowd")?.text ?? "—"}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Route cards — div role=button so they can hold the factor list. */}
            {cards.length > 0 && (
              <div className={styles.cards}>
                {cards.map((c) => (
                  <div
                    key={c.id}
                    role="button"
                    tabIndex={0}
                    className={styles.card}
                    aria-pressed={selected === c.id}
                    aria-label={`${c.name}, ${c.minutes} minutes${
                      c.extraMin > 0 ? `, ${c.extraMin} minutes more than shortest` : ""
                    }${selected === c.id ? ", selected" : ""}`}
                    onClick={() => setSelected(c.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelected(c.id);
                      }
                    }}
                  >
                    <span className={styles.cardHead}>
                      <span className={`${styles.badge} ${c.cls}`} aria-hidden="true">{c.letter}</span>
                      <span className={styles.cardName}>{c.name}</span>
                      {selected === c.id && (
                        <span className={styles.cardSelected}>
                          <CheckIcon style={{ width: 16, height: 16 }} />
                          Selected
                        </span>
                      )}
                    </span>
                    <p className={styles.cardMeta}>
                      {c.minutes} min · {(c.lengthM / 1000).toFixed(1)} km
                      {c.extraMin > 0 ? ` · +${c.extraMin} min vs shortest` : ""}
                    </p>
                    {c.factors.length > 0 && (
                      <ul className={styles.cardFactors}>
                        {c.factors.map((f) => (
                          <li key={f.key}>
                            <span className={styles.fLabel}>{f.label}</span>
                            {f.levelWord ? (
                              <span>
                                {f.text}
                                {f.noDataPct > 0 && (
                                  <span className={styles.gapTag}> <span className={styles.gapQ}>?</span></span>
                                )}
                              </span>
                            ) : (
                              <span className={styles.gapTag}>
                                <span className={styles.gapQ}>?</span> No data yet
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Stretches with no data (MAP-01 non-visual access) */}
            {selCard && noDataStretches > 0 && (
              <details style={{ marginTop: "0.7rem" }}>
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                  Stretches with no data ({noDataStretches})
                </summary>
                <ul style={{ listStyle: "none", padding: 0, margin: "0.4rem 0 0" }}>
                  {selCard.feature.uncertain_segments.map((seg, i) => (
                    <li key={i} style={{ margin: "0.2rem 0" }}>
                      <button
                        type="button"
                        className={styles.btn}
                        style={{ width: "100%", justifyContent: "flex-start" }}
                        onClick={() => flyToSegment(seg)}
                      >
                        <InfoIcon />
                        Stretch {i + 1}: no data for your factors here
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {/* Primary action. Turn-by-turn guidance (F5) is not built in this
                prototype, so we say so plainly rather than open a dead screen. */}
            <button
              type="button"
              className={styles.primary}
              disabled={!selCard}
              onClick={() =>
                setWalkNote("Turn-by-turn guidance is coming soon. For now, follow your route on the map.")
              }
            >
              Start walking
            </button>
            {walkNote && (
              <p className={styles.hint} role="status" aria-live="polite" style={{ marginTop: "0.5rem" }}>
                {walkNote}
              </p>
            )}

            {/* Manual entry fallback (INP-06 alternative) */}
            <form onSubmit={onSubmit} style={{ marginTop: "0.8rem" }}>
              <div className={styles.row}>
                <button type="submit" className={styles.btn}>Get route from typed points</button>
                <button type="button" className={styles.btn} onClick={reset}>Reset</button>
              </div>
            </form>
          </div>
        </div>
      </section>

      {/* ---- Sheets & flows ---- */}
      <SettingsSheet
        open={sheetOpen === "settings"}
        onClose={() => setSheetOpen(null)}
        returnFocusRef={settingsBtn}
        settings={settings}
        onChange={patchSettings}
        onReset={() => {
          const d = { ...DEFAULT_SETTINGS };
          setSettings(d);
          saveSettings(d);
          applySettings(d);
        }}
        onDeleteData={deleteData}
      />
      <HelpSheet
        open={sheetOpen === "help"}
        onClose={() => setSheetOpen(null)}
        returnFocusRef={helpBtn}
        onOpenLegend={() => setSheetOpen("legend")}
      />
      <LegendSheet
        open={sheetOpen === "legend"}
        onClose={() => setSheetOpen(null)}
        returnFocusRef={legendBtn}
      />

      {/* Adjust (strictness / max extra time / prefer-more-data) */}
      <Sheet
        open={sheetOpen === "adjust"}
        onClose={() => setSheetOpen(null)}
        title="Adjust routing"
        returnFocusRef={adjustBtn}
        labelId="adjust-title"
      >
        <p className={styles.hint}>How hard should we avoid the things you picked?</p>
        <div className={styles.profileRow}>
          <button
            type="button"
            className={styles.toggle}
            aria-pressed={settings.strictness === "flexible"}
            onClick={() => patchSettings({ strictness: "flexible" })}
          >
            {settings.strictness === "flexible" && <CheckIcon className={styles.check} />}
            Flexible
          </button>
          <button
            type="button"
            className={styles.toggle}
            aria-pressed={settings.strictness === "strict"}
            onClick={() => patchSettings({ strictness: "strict" })}
          >
            {settings.strictness === "strict" && <CheckIcon className={styles.check} />}
            Strict
          </button>
        </div>
        <p className={styles.hint}>
          More detailed routing limits (maximum extra time, preferring routes with more data) are in
          Settings → Routing.
        </p>
      </Sheet>

      <OverwhelmFlow
        open={overwhelm}
        onClose={() => {
          setOverwhelm(false);
          overwhelmBtn.current?.focus();
        }}
        savedContact={settings.savedContact}
      />
    </div>
  );
}
