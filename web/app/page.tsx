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
import PlaceField from "@/components/PlaceField";
import SettingsSheet from "@/components/SettingsSheet";
import LegendSheet from "@/components/LegendSheet";
import LayersSheet, { DEFAULT_LAYERS, type MapLayers } from "@/components/LayersSheet";
import Onboarding, { type OnboardProfile } from "@/components/Onboarding";
import OverwhelmFlow from "@/components/OverwhelmFlow";
import AddPlaceSheet from "@/components/AddPlaceSheet";
import PlaceSheet from "@/components/PlaceSheet";
import { listPlaces, type Place } from "@/lib/places";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  GearIcon,
  HeartPulseIcon,
  LayersIcon,
  LegendIcon,
  LocateIcon,
  MinusIcon,
  PinIcon,
  PlusIcon,
  SwapIcon,
  WarningIcon,
} from "@/components/icons";
import styles from "./page.module.css";

const MAP_STYLE =
  process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/bright";
const KRAKOW_CENTER: [number, number] = [19.9372, 50.0614];
const ROUTE_SRC = "route";
const ALT_SRC = "route-alt";
const UNC_SRC = "route-uncertain";
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Status = "idle" | "picking" | "loading" | "ready" | "error";
type RouteId = "best" | "shortest";
// collapsed = handle row only, half = the default half-open sheet (LAY-06),
// expanded = nearly full height.
type SheetState = "collapsed" | "half" | "expanded";

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

function placeMarkerEl(disputed: boolean): HTMLDivElement {
  const el = document.createElement("div");
  el.className = `place-marker${disputed ? " disputed" : ""}`;
  el.setAttribute("aria-hidden", "true");
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
  // Two independently collapsible panels float over a full-bleed map, so on a
  // phone the map is always reachable and either panel can give it back space.
  // LAY-06: the sheet changes size by button only, never by drag alone.
  const [sheetState, setSheetState] = useState<SheetState>("collapsed");
  // True while a finger/pointer is dragging the sheet handle (drawer gesture).
  // Used to keep the body mounted while dragging up from the collapsed state.
  const [dragging, setDragging] = useState(false);
  const [topOpen, setTopOpen] = useState(true);
  const [showCompare, setShowCompare] = useState(false);
  const [sheetOpen, setSheetOpen] = useState<
    "settings" | "legend" | "adjust" | "layers" | "addPlace" | "place" | null
  >(null);
  const [overwhelm, setOverwhelm] = useState(false);
  const [avail, setAvail] = useState({ noise: true, light: true, crowd: false });
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Which overlays are drawn over the map (display only — never changes the route).
  const [layers, setLayers] = useState<MapLayers>(DEFAULT_LAYERS);
  const patchLayers = useCallback(
    (patch: Partial<MapLayers>) => setLayers((prev) => ({ ...prev, ...patch })),
    [],
  );

  // ---- Quiet places (user-submitted, §2O) ----
  const [places, setPlaces] = useState<Place[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const placeMarkers = useRef<maplibregl.Marker[]>([]);
  const [addPlaceLocation, setAddPlaceLocation] = useState<LatLon | null>(null);
  const addPlaceMode = useRef(false); // crosshair pick-a-location mode
  const [addingPlace, setAddingPlace] = useState(false); // drives the banner + cursor
  const addPlaceBtn = useRef<HTMLButtonElement | null>(null);

  // Trigger refs so sheets can return focus (LAY-06).
  const settingsBtn = useRef<HTMLButtonElement | null>(null);
  const legendBtn = useRef<HTMLButtonElement | null>(null);
  const layersBtn = useRef<HTMLButtonElement | null>(null);
  const adjustBtn = useRef<HTMLButtonElement | null>(null);
  const overwhelmBtn = useRef<HTMLButtonElement | null>(null);
  const topToggleBtn = useRef<HTMLButtonElement | null>(null);
  const sheetBtn = useRef<HTMLButtonElement | null>(null);
  const sheetEl = useRef<HTMLElement | null>(null);
  const shellEl = useRef<HTMLDivElement | null>(null);

  // Panel-collapse bookkeeping. The planning panel folds away once, after the
  // first route of the session, so the map gets the screen. It never does so
  // again if the user has touched the panel themselves (P4: nothing changes
  // unless asked), and one tap brings it straight back.
  const userToggledTop = useRef(false);
  const autoCollapsedTop = useRef(false);

  // Sheet bookkeeping: it starts collapsed, then opens to half once, when the
  // first routes land — unless the user has already moved it themselves (by
  // button or by dragging the drawer). After that it never moves on its own.
  const userToggledSheet = useRef(false);
  const autoOpenedSheet = useRef(false);
  // Live drawer-drag state (imperative, so a drag doesn't re-render every frame).
  const drag = useRef<{ startY: number; startH: number; active: boolean; moved: boolean } | null>(null);

  // Mirror live trip inputs so the stable map-click handler reads current values.
  const opts = useRef({ noise, light, crowd, settings, whenMode, leaveAt, layers });
  useEffect(() => {
    opts.current = { noise, light, crowd, settings, whenMode, leaveAt, layers };
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
    if (!s.onboarded) setShowOnboarding(true); // first-run setup (F1)
    /* eslint-enable react-hooks/set-state-in-effect */
    getHealth()
      .then((h) => setAvail(h.factors))
      .catch(() => {});
    // Quiet places are optional — a failure here must never break the map.
    listPlaces()
      .then(setPlaces)
      .catch(() => {});
  }, []);

  // ----- Onboarding (F1) -----
  const finishOnboarding = useCallback(
    (profile?: OnboardProfile) => {
      setShowOnboarding(false);
      if (profile) {
        setNoise(profile.noise);
        setLight(profile.light);
        setCrowd(profile.crowd);
        patchSettings({ onboarded: true, profile });
      } else {
        patchSettings({ onboarded: true });
      }
    },
    [patchSettings],
  );

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
    // Suppressed when the no-data layer is switched off in Map layers.
    qMarkers.current.forEach((m) => m.remove());
    qMarkers.current = [];
    for (const seg of o.layers.noData ? sel?.uncertain_segments ?? [] : []) {
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

  // ----- Map layer visibility (the "Layers" control) -----
  // Display-only: toggles which overlays are drawn, never the route itself.
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getLayer("route-uncertain-line")) return;
    const vis = (on: boolean) => (on ? "visible" : "none");
    map.setLayoutProperty("route-uncertain-line", "visibility", vis(layers.noData));
    map.setLayoutProperty("route-alt-line", "visibility", vis(layers.altRoute));
    // Re-run the draw so the "?" markers appear or disappear with the dashes.
    drawSelected();
  }, [layers, drawSelected]);

  // ----- Quiet places: markers + add-place flow (BIZ-15, MAP-05) -----
  const drawPlaces = useCallback(() => {
    const map = mapRef.current;
    placeMarkers.current.forEach((m) => m.remove());
    placeMarkers.current = [];
    if (!map || !layers.quietPlaces) return;
    for (const p of places) {
      const marker = new maplibregl.Marker({ element: placeMarkerEl(p.disputed) })
        .setLngLat([p.lon, p.lat])
        .addTo(map);
      marker.getElement().addEventListener("click", (e) => {
        e.stopPropagation();
        setSelectedPlace(p);
        setSheetOpen("place");
      });
      placeMarkers.current.push(marker);
    }
  }, [places, layers.quietPlaces]);

  // Latest drawPlaces, so the map 'load' handler can draw markers the moment the
  // map is ready even if the places fetch resolved first (avoids a missed draw).
  const drawPlacesRef = useRef(drawPlaces);
  useEffect(() => {
    drawPlacesRef.current = drawPlaces;
  }, [drawPlaces]);

  useEffect(() => {
    drawPlaces();
  }, [drawPlaces]);

  const cancelAddPlace = useCallback(() => {
    addPlaceMode.current = false;
    setAddingPlace(false);
    const canvas = mapRef.current?.getCanvas();
    if (canvas) canvas.style.cursor = "";
  }, []);

  const finishAddPlace = useCallback((loc: LatLon) => {
    addPlaceMode.current = false;
    setAddingPlace(false);
    const canvas = mapRef.current?.getCanvas();
    if (canvas) canvas.style.cursor = "";
    setAddPlaceLocation(loc);
    setSheetOpen("addPlace");
  }, []);

  const beginAddPlace = useCallback(() => {
    setAddPlaceLocation(null);
    addPlaceMode.current = true;
    setAddingPlace(true);
    setSheetOpen(null);
    const canvas = mapRef.current?.getCanvas();
    if (canvas) canvas.style.cursor = "crosshair";
  }, []);

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
        // Planning is done, so hand the screen back to the map — once per
        // session, and never if the user has been using the panel themselves.
        if (!autoCollapsedTop.current && !userToggledTop.current) {
          autoCollapsedTop.current = true;
          setTopOpen(false);
        }
        // The sheet starts collapsed; lift it to half the first time results
        // land so they are actually seen — but only if the user hasn't already
        // moved it themselves (button or drawer drag).
        if (!autoOpenedSheet.current && !userToggledSheet.current) {
          autoOpenedSheet.current = true;
          setSheetState("half");
        }
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
      // In "add place" mode the click pins a location instead of a route point.
      if (addPlaceMode.current) {
        finishAddPlace(p);
        return;
      }
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
    [setEndpoint, requestRoutes, finishAddPlace],
  );

  // Re-route when the profile / time changes and we already have both endpoints.
  useEffect(() => {
    if (startPt.current && endPt.current) void requestRoutes(startPt.current, endPt.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noise, light, crowd, whenMode, leaveAt, settings.strictness]);

  // The overwhelm pill and the map controls are anchored with calc() against
  // --sheet-offset. In the collapsed and half states the sheet has a fixed CSS
  // height, so that offset is exact. Expanded is content-height, so the offset
  // would drift away from the real card and leave the pill floating mid-map.
  // Publishing the measured height back as --sheet-measured keeps every anchor
  // glued to the card's actual top edge in all three states.
  useEffect(() => {
    const sheet = sheetEl.current;
    const shell = shellEl.current;
    if (!sheet || !shell) return;
    const publish = () => {
      shell.style.setProperty("--sheet-measured", `${sheet.offsetHeight}px`);
    };
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(sheet);
    window.addEventListener("resize", publish);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", publish);
    };
  }, []);

  // Escape dismisses the expanded sheet, matching the settings dialog. Only when
  // the sheet is the expanded one — a modal sheet has its own handler, and the
  // two must not both react to one key press.
  useEffect(() => {
    if (sheetState !== "expanded" || sheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setSheetState("collapsed");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheetState, sheetOpen]);

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
      drawPlacesRef.current();
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

  // ---- Panel controls ----
  // One button cycles the sheet through its three sizes (LAY-06). The label
  // always names what the next press will do, so it never has to be guessed.
  const SHEET_CYCLE: Record<SheetState, SheetState> = {
    collapsed: "half",
    half: "expanded",
    expanded: "collapsed",
  };
  const SHEET_ACTION_LABEL: Record<SheetState, string> = {
    collapsed: "Show results",
    half: "Expand",
    expanded: "Hide",
  };
  const cycleSheet = () => {
    userToggledSheet.current = true;
    setSheetState((s) => SHEET_CYCLE[s]);
    // LAY-06: focus stays on the button that changed the sheet's size.
    sheetBtn.current?.focus();
  };

  // ---- Drawer drag (an enhancement over the button, not a replacement — the
  // Expand/Hide button stays for keyboard and assistive tech, so LAY-06 holds).
  // Dragging the handle follows the finger, then snaps to the nearest of the
  // three sizes on release. Works with mouse and touch via Pointer Events. ----
  const snapHeights = () => {
    const vh = window.innerHeight;
    const mobile = window.matchMedia("(max-width: 480px)").matches;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    return {
      collapsed: 3.9 * rem,
      half: vh * (mobile ? 0.28 : 0.3),
      expanded: vh * (mobile ? 0.8 : 0.72),
    };
  };

  const onHandlePointerDown = (e: React.PointerEvent) => {
    // A press that starts on the toggle button is a click, not a drag.
    if ((e.target as HTMLElement).closest("button")) return;
    const sheet = sheetEl.current;
    if (!sheet) return;
    drag.current = { startY: e.clientY, startH: sheet.offsetHeight, active: true, moved: false };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onHandlePointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const sheet = sheetEl.current;
    if (!d?.active || !sheet) return;
    const snaps = snapHeights();
    const h = Math.max(snaps.collapsed, Math.min(snaps.expanded, d.startH + (d.startY - e.clientY)));
    if (Math.abs(e.clientY - d.startY) > 4) d.moved = true;
    sheet.style.height = `${h}px`;
  };

  const endHandleDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    const sheet = sheetEl.current;
    drag.current = null;
    setDragging(false);
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (!d || !sheet) return;
    const h = sheet.offsetHeight;
    sheet.style.height = ""; // hand height back to CSS for the chosen state
    if (!d.moved) return; // a tap, not a drag — let the button's onClick handle it
    const snaps = snapHeights();
    const nearest = (["collapsed", "half", "expanded"] as SheetState[]).reduce((best, s) =>
      Math.abs(snaps[s] - h) < Math.abs(snaps[best] - h) ? s : best,
    );
    userToggledSheet.current = true;
    setSheetState(nearest);
  };

  const toggleTop = (next: boolean) => {
    userToggledTop.current = true;
    setTopOpen(next);
  };

  const endpointSummary = `${startText.trim() || "Your location"} to ${
    endText.trim() || "destination"
  }`;

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
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("krk.settings");
      window.localStorage.removeItem("krk.device");
      window.localStorage.removeItem("krk.votes");
    }
    const d = { ...DEFAULT_SETTINGS };
    setSettings(d);
    applySettings(d);
    setNoise(false);
    setLight(null);
    setCrowd(false);
    setSheetOpen(null);
    setShowOnboarding(!d.onboarded); // a cleared device is a first run again (F1)
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

  return (
    <div ref={shellEl} className={styles.shell} data-sheet={sheetState} data-top={topOpen ? "open" : "closed"}>
      <a className="skip-link" href="#routes">Skip to routes</a>

      {/* ---- Top stack: collapsible planning panel, floating over the map ---- */}
      <div className={styles.topStack}>
        {!topOpen ? (
          <div className={styles.topBarCollapsed}>
            <button
              ref={topToggleBtn}
              type="button"
              className={styles.mapBtn}
              onClick={() => toggleTop(true)}
              aria-expanded={false}
              aria-controls="plan-fields"
              aria-label="Show start and destination"
            >
              <ChevronDownIcon />
            </button>
            <button
              type="button"
              className={styles.topSummary}
              onClick={() => toggleTop(true)}
            >
              <span className={styles.topSummaryText}>{endpointSummary}</span>
            </button>
          </div>
        ) : (
          <>
            <div className={styles.panel} id="plan-fields">
              <div className={styles.fieldsRow}>
                <div className={styles.fields}>
                  <PlaceField
                    label="Start"
                    placeholder="Your location, a place name or lat, lon"
                    value={startText}
                    onTextChange={setStartText}
                    onSelect={(p) => {
                      setEndpoint("start", p);
                      setStatus("picking");
                    }}
                    language={settings.language}
                  />
                  <PlaceField
                    label="Destination"
                    placeholder="Tap the map, a place name or lat, lon"
                    value={endText}
                    onTextChange={setEndText}
                    onSelect={(p) => {
                      setEndpoint("end", p);
                      if (startPt.current) void requestRoutes(startPt.current, p);
                    }}
                    language={settings.language}
                  />
                </div>
              </div>
              <div className={styles.swapRow}>
                <button type="button" className={styles.btn} onClick={swap}>
                  <SwapIcon />
                  Swap
                </button>
                <button
                  type="button"
                  className={styles.btn}
                  onClick={() => toggleTop(false)}
                  aria-expanded
                  aria-controls="plan-fields"
                >
                  <ChevronUpIcon />
                  Hide fields
                </button>
              </div>
              {/* When row: Now / Leave at (FAC-04). Kept in the SAME card as the
                  fields — a second floating card cost another padding block and
                  gap, which is map we did not have to give up. */}
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
            </div>
          </>
        )}
      </div>

      {/* ---- Map: full-bleed, behind every panel ---- */}
      <div className={styles.mapWrap}>
        <div
          ref={mapContainer}
          className={styles.map}
          role="application"
          aria-label="Map of Kraków. Tap to set start and destination."
        />

        {addingPlace && (
          <div
            role="status"
            style={{
              position: "absolute",
              top: "0.75rem",
              left: "50%",
              transform: "translateX(-50%)",
              background: "var(--surface)",
              border: "1px solid var(--border-strong)",
              borderRadius: "10px",
              padding: "0.55rem 0.8rem",
              display: "flex",
              gap: "0.75rem",
              alignItems: "center",
              boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
              zIndex: 10,
            }}
          >
            <span>Tap the map to place your place.</span>
            <button type="button" className={styles.btn} onClick={cancelAddPlace} style={{ minHeight: "40px" }}>
              Cancel
            </button>
          </div>
        )}

        <div className={`${styles.mapControls} ${styles.right}`}>
          <button type="button" className={styles.mapBtn} onClick={() => zoom(1)} aria-label="Zoom in">
            <PlusIcon />
          </button>
          <button type="button" className={styles.mapBtn} onClick={() => zoom(-1)} aria-label="Zoom out">
            <MinusIcon />
          </button>
          <button type="button" className={styles.mapBtn} onClick={locate} aria-label="Use my location">
            <LocateIcon />
          </button>
          <button
            ref={layersBtn}
            type="button"
            className={styles.mapBtn}
            onClick={() => setSheetOpen("layers")}
            aria-haspopup="dialog"
            aria-label="Map layers"
          >
            <LayersIcon />
          </button>
        </div>
        <div className={`${styles.mapControls} ${styles.left}`}>
          <button
            type="button"
            className={`${styles.mapBtn} ${styles.mapBtnWide} ${layers.quietPlaces ? styles.mapBtnActive : ""}`}
            aria-pressed={layers.quietPlaces}
            onClick={() => patchLayers({ quietPlaces: !layers.quietPlaces })}
            aria-label="Show quiet places"
          >
            <PinIcon />
            Quiet places
          </button>
          <button
            ref={addPlaceBtn}
            type="button"
            className={`${styles.mapBtn} ${styles.mapBtnWide}`}
            onClick={beginAddPlace}
            aria-haspopup="dialog"
            aria-label="Add a quiet place"
          >
            <PinIcon />
            Add place
          </button>
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
            ref={settingsBtn}
            type="button"
            className={`${styles.mapBtn} ${styles.mapBtnWide}`}
            onClick={() => setSheetOpen("settings")}
          >
            <GearIcon />
            Settings
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

      {/* ---- Bottom sheet: collapsible by button only (LAY-06) ----
          Expanded, it takes the settings dialog's treatment: a dimmed backdrop
          and a floating card sized to its content, so it stops being a
          full-bleed panel with dead space under the last row. */}
      {sheetState === "expanded" && (
        <div
          className={styles.sheetScrim}
          aria-hidden="true"
          onMouseDown={() => setSheetState("collapsed")}
        />
      )}
      <section ref={sheetEl} className={styles.sheet} aria-label="Plan a walk" id="routes">
        <div
          className={styles.sheetHandle}
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={endHandleDrag}
          onPointerCancel={endHandleDrag}
        >
          <span className={styles.sheetGrabber} aria-hidden="true" />
          {/* When collapsed the body is gone, so the status replaces the title —
              otherwise a collapsed sheet looks inert (AT-02). */}
          {sheetState === "collapsed" && status !== "idle" ? (
            <span className={styles.sheetPeek} role="status" aria-live="polite">
              {statusText}
            </span>
          ) : (
            <h1 className={styles.sheetTitle}>Plan a walk</h1>
          )}
          <button
            ref={sheetBtn}
            type="button"
            className={`${styles.btn} ${styles.sheetToggle}`}
            onClick={cycleSheet}
            aria-expanded={sheetState !== "collapsed"}
            aria-controls="sheet-body"
          >
            {sheetState === "expanded" ? <ChevronDownIcon /> : <ChevronUpIcon />}
            {SHEET_ACTION_LABEL[sheetState]}
          </button>
        </div>

        {(sheetState !== "collapsed" || dragging) && (
        <div className={styles.sheetBody} id="sheet-body">
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

            {/* Manual entry fallback (INP-06 alternative) */}
            <form onSubmit={onSubmit} style={{ marginTop: "0.8rem" }}>
              <div className={styles.row}>
                <button type="submit" className={styles.btn}>Get route from typed points</button>
                <button type="button" className={styles.btn} onClick={reset}>Reset</button>
              </div>
            </form>
          </div>
        </div>
        )}
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
      <LegendSheet
        open={sheetOpen === "legend"}
        onClose={() => setSheetOpen(null)}
        returnFocusRef={legendBtn}
      />
      <LayersSheet
        open={sheetOpen === "layers"}
        onClose={() => setSheetOpen(null)}
        returnFocusRef={layersBtn}
        layers={layers}
        onChange={patchLayers}
      />
      <AddPlaceSheet
        open={sheetOpen === "addPlace"}
        onClose={() => {
          setSheetOpen(null);
          cancelAddPlace();
        }}
        returnFocusRef={addPlaceBtn}
        location={addPlaceLocation}
        onChooseOnMap={beginAddPlace}
        onCreated={(p) => {
          setSheetOpen(null);
          setPlaces((prev) => [...prev, p]);
          setSelectedPlace(p);
          setSheetOpen("place");
        }}
      />
      <PlaceSheet
        open={sheetOpen === "place"}
        onClose={() => setSheetOpen(null)}
        place={selectedPlace}
        onChanged={(p) => {
          setSelectedPlace(p);
          setPlaces((prev) => prev.map((x) => (x.id === p.id ? p : x)));
        }}
        onRouteThere={(p) => {
          setSheetOpen(null);
          setEndpoint("end", { lat: p.lat, lon: p.lon });
          if (startPt.current) void requestRoutes(startPt.current, { lat: p.lat, lon: p.lon });
          else setStatus("picking");
        }}
      />

      {/* First-run setup (F1): ask once which things to avoid, save as default. */}
      <Onboarding
        open={showOnboarding}
        availCrowd={avail.crowd}
        onSkip={() => finishOnboarding()}
        onSave={(p) => finishOnboarding(p)}
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
        onGoThere={(p) => {
          setOverwhelm(false);
          setEndpoint("end", { lat: p.lat, lon: p.lon });
          if (startPt.current) void requestRoutes(startPt.current, { lat: p.lat, lon: p.lon });
          else setStatus("picking");
        }}
      />
    </div>
  );
}
