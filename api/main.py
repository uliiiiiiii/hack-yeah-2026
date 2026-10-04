"""Routing API: serve walking routes from the parquet contracts.

Run from api/:
    uvicorn main:app --reload --port 8000

Endpoints:
    GET /route?from=lat,lon&to=lat,lon&profile=shortest
    GET /route?from=..&to=..&profile=sensory&noise=on&light=prefer_lit&strength=medium
    GET /health

The sensory profile lets a user pick the issues that affect them (noise, light)
and routes around them, while reporting where the underlying data is unknown.
"""
import os
import threading
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import crowds
import places
import places_store
import profiles
from graph import Graph, GraphError
from profiles import LIGHT_MODES, STRENGTH_WEIGHT, PROFILES, sensory_cost

# Load the repo-root .env (if present) so BESTTIME_API_KEY_PRIVATE etc. are set.
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except Exception:
    pass

KRAKOW_TZ = ZoneInfo("Europe/Warsaw")

WALK_SPEED_KMH = 5.0
LOUD_DB = 65.0  # Lden at/above this counts as "loud" in the route summary
DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).resolve().parent.parent / "data"))

app = FastAPI(title="Ciszej API")

# Defaults cover the web dev server plus the origins a Capacitor WebView uses
# (Android serves the bundled app from https://localhost, iOS from
# capacitor://localhost). Override with the ALLOWED_ORIGINS env var.
_DEFAULT_ORIGINS = "http://localhost:3000,https://localhost,capacitor://localhost"
allowed_origins = [
    o.strip() for o in os.environ.get("ALLOWED_ORIGINS", _DEFAULT_ORIGINS).split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

try:
    GRAPH: Graph | None = Graph(DATA_DIR)
    _LOAD_ERROR: str | None = None
except GraphError as exc:
    GRAPH = None
    _LOAD_ERROR = str(exc)

CROWD = crowds.CrowdState()


def _krakow_now() -> tuple[int, int]:
    """Current (day_int 0=Mon, hour 0-23) in Kraków local time."""
    now = datetime.now(KRAKOW_TZ)
    return now.weekday(), now.hour


def _refresh_crowd_async(live: bool = False) -> None:
    """Refresh current crowd data in the background (never blocks a request)."""
    if GRAPH is None or not crowds.configured():
        return
    day, hour = _krakow_now()
    threading.Thread(
        target=CROWD.refresh, args=(GRAPH,),
        kwargs={"now_day": day, "now_hour": hour, "live": live},
        daemon=True,
    ).start()


if GRAPH is not None and crowds.configured():
    _refresh_crowd_async()  # warm the crowd layer at startup


def error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": code, "message": message})


def parse_point(raw: str | None, name: str) -> tuple[float, float]:
    if raw is None or raw.strip() == "":
        raise ValueError(f"Missing '{name}' parameter. Expected '{name}=lat,lon'.")
    parts = raw.split(",")
    if len(parts) != 2:
        raise ValueError(f"'{name}' must be 'lat,lon', got '{raw}'.")
    try:
        lat, lon = float(parts[0]), float(parts[1])
    except ValueError:
        raise ValueError(f"'{name}' must be two numbers 'lat,lon', got '{raw}'.")
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError(f"'{name}' is out of range: lat must be -90..90, lon -180..180.")
    return lat, lon


_TRUE = {"1", "true", "on", "yes", "avoid"}


def _parse_when(q) -> tuple[int, int | None]:
    """Resolve an optional 'Leave at' time from when_day/when_hour query params.

    Returns (day_int, hour) with hour in 0..23, or (current_day, None) if absent
    or invalid (meaning "now"). Day defaults to today if only the hour is given.
    """
    cur_day, _ = _krakow_now()
    raw_hour = (q.get("when_hour") or "").strip()
    if raw_hour == "":
        return cur_day, None
    try:
        hour = int(raw_hour)
    except ValueError:
        return cur_day, None
    if not (0 <= hour <= 23):
        return cur_day, None
    day = cur_day
    raw_day = (q.get("when_day") or "").strip()
    if raw_day != "":
        try:
            d = int(raw_day)
            if 0 <= d <= 6:
                day = d
        except ValueError:
            pass
    return day, hour


def available_factors() -> dict:
    """Which sensory factors the loaded data can actually support."""
    if GRAPH is None:
        return {}
    return {
        "noise": bool(getattr(GRAPH, "has_sensory", False)
                      and "noise_lden_db" in GRAPH.edges.columns),
        "light": "lit" in GRAPH.edges.columns,
        "crowd": crowds.configured(),
    }


@app.get("/health")
def health():
    if GRAPH is None:
        return error(503, "not_ready", _LOAD_ERROR or "Data not loaded.")
    return {
        "status": "ok",
        "node_count": GRAPH.n_nodes,
        "edge_count": int(len(GRAPH.edges)),
        "data_built_at": GRAPH.data_built_at,
        "profiles": sorted(PROFILES.keys()) + ["sensory"],
        "factors": available_factors(),
        "crowd_status": {
            "configured": crowds.configured(),
            "loaded": CROWD.loaded,
            "venue_count": CROWD.venue_count,
            "last_error": CROWD.last_error,
        },
    }


PLACE_LANGS = {"en", "pl", "uk"}


@app.get("/places")
def search_places(q: str | None = None, lang: str = "en"):
    """Place-name search, proxied to OpenStreetMap Nominatim (free, no API key).

    Only user-submitted queries reach Nominatim — the web app never searches on
    every keystroke, because Nominatim's usage policy forbids client-side
    auto-complete over the public API. This proxy also throttles to one request
    per second, caches results for an hour and sends the identifying User-Agent
    the policy requires (see api/places.py).

    Results are bounded to the Kraków viewbox so they match what we can route.
    """
    raw = (q or "").strip()
    if len(raw) < places.MIN_QUERY_LEN:
        return error(
            400, "bad_request",
            f"Type at least {places.MIN_QUERY_LEN} characters of a place name.",
        )
    try:
        results = places.search(raw, lang=lang if lang in PLACE_LANGS else "en")
    except places.GeocodeError as exc:
        # Never masquerade as "no results" — say the service is unavailable.
        return error(502, "place_search_unavailable", str(exc))
    return {
        "query": raw,
        "source": "OpenStreetMap Nominatim",
        "attribution": places.ATTRIBUTION,
        "results": results,
    }


# ---- Quiet places (§2O/§2P): declared quiet-hours places + votes + check-ins ----
# A separate layer from street routing (BIZ-14). Declared data is always
# Estimated / "Reported by a person", never Known (BIZ-05); votes are opinions,
# not verification (ACC-05).

async def _read_json(request: Request) -> dict | None:
    """Read a JSON object body, or None if it is missing/malformed."""
    try:
        body = await request.json()
    except Exception:
        return None
    return body if isinstance(body, dict) else None


def _device_id(body: dict) -> str | None:
    """A non-empty, length-capped anonymous device id, or None."""
    raw = str(body.get("device_id") or "").strip()
    if not raw or len(raw) > 64:
        return None
    return raw


@app.get("/quiet-places")
def list_places(bbox: str | None = None):
    """All user-submitted quiet places, optionally bounded to a bbox.

    ``bbox`` is ``minLon,minLat,maxLon,maxLat`` (matching the map viewport).
    """
    box = None
    if bbox:
        parts = bbox.split(",")
        if len(parts) == 4:
            try:
                box = tuple(float(p) for p in parts)
            except ValueError:
                box = None
    return {"places": places_store.list_places(box)}


@app.get("/quiet-places/{place_id}")
def get_place(place_id: int):
    place = places_store.get_place(place_id)
    if place is None:
        return error(404, "not_found", "No such place.")
    return place


@app.post("/quiet-places")
async def create_place(request: Request):
    body = await _read_json(request)
    if body is None:
        return error(400, "bad_request", "Send a JSON body with a name, location and quiet hours.")

    name = str(body.get("name") or "").strip()
    if not name:
        return error(400, "bad_request", "Give the place a name.")
    if len(name) > 120:
        return error(400, "bad_request", "The name is too long.")
    type_ = str(body.get("type") or "").strip()[:60]

    try:
        lat = float(body.get("lat"))
        lon = float(body.get("lon"))
    except (TypeError, ValueError):
        return error(400, "bad_request", "The place needs a latitude and longitude.")
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return error(400, "bad_request", "The location is out of range.")
    if GRAPH is not None and not GRAPH.in_bbox(lat, lon):
        return error(422, "out_of_area", "That point is outside the covered Kraków area.")

    entry_condition = str(body.get("entry_condition") or "open_to_anyone").strip()
    if entry_condition not in places_store.ENTRY_CONDITIONS:
        return error(400, "bad_request", "Unknown entry condition.")

    try:
        schedule = places_store.normalize_quiet_hours(body.get("quiet_hours"))
    except ValueError as exc:
        return error(400, "bad_request", str(exc))

    device_id = _device_id(body)
    if device_id is None:
        return error(400, "bad_request", "A device id is needed to save your place.")

    place = places_store.create_place(
        name=name, type_=type_, lat=lat, lon=lon,
        entry_condition=entry_condition, quiet_hours=schedule, device_id=device_id,
    )
    return place


@app.post("/quiet-places/{place_id}/vote")
async def vote(place_id: int, request: Request):
    body = await _read_json(request)
    if body is None:
        return error(400, "bad_request", "Send a JSON body with device_id and value.")
    value = str(body.get("value") or "").strip()
    if value not in ("accurate", "not_accurate"):
        return error(400, "bad_request", "Vote must be 'accurate' or 'not_accurate'.")
    device_id = _device_id(body)
    if device_id is None:
        return error(400, "bad_request", "A device id is needed to vote.")
    place = places_store.vote(place_id, device_id, value)
    if not place:
        return error(404, "not_found", "No such place.")
    return place


@app.post("/quiet-places/{place_id}/checkin")
async def checkin(place_id: int, request: Request):
    body = await _read_json(request)
    if body is None:
        return error(400, "bad_request", "Send a JSON body with device_id.")
    device_id = _device_id(body)
    if device_id is None:
        return error(400, "bad_request", "A device id is needed to check in.")
    value = body.get("value")
    if value is not None and str(value) not in ("yes", "no", "not_sure"):
        return error(400, "bad_request", "Check-in answer must be 'yes', 'no' or 'not_sure'.")
    place = places_store.checkin(place_id, device_id, value)
    if not place:
        return error(404, "not_found", "No such place.")
    return place


@app.post("/quiet-places/{place_id}/verify")
async def verify(place_id: int, request: Request):
    expected = os.environ.get("VERIFY_TOKEN")
    if not expected:
        return error(401, "not_allowed", "Verification is not enabled on this server.")
    body = await _read_json(request)
    if body is None or body.get("token") != expected:
        return error(401, "not_allowed", "Wrong verification token.")
    verified = bool(body.get("verified", True))
    note = str(body.get("note") or "").strip() or None
    place = places_store.verify(place_id, verified=verified, note=note)
    if place is None:
        return error(404, "not_found", "No such place.")
    return place


@app.get("/calm-places")
def calm_places(lat: str | None = None, lon: str | None = None,
                day: str | None = None, hour: str | None = None):
    """Eligible calm places for the overwhelm flow (F13): quiet hours active now
    and not disputed, nearest first. Straight-line distance; walk time is an
    estimate, not a routed distance. Optional day (0=Mon..6=Sun) + hour target a
    specific time (mirrors /route's when_day/when_hour)."""
    try:
        lat_f = float(lat)
        lon_f = float(lon)
    except (TypeError, ValueError):
        return error(400, "bad_request", "calm-places needs lat and lon.")
    if not (-90 <= lat_f <= 90 and -180 <= lon_f <= 180):
        return error(400, "bad_request", "The location is out of range.")
    day_i = hour_i = None
    if day is not None and hour is not None:
        try:
            day_i, hour_i = int(day), int(hour)
            if not (0 <= day_i <= 6 and 0 <= hour_i <= 23):
                day_i = hour_i = None
        except ValueError:
            day_i = hour_i = None
    return {"places": places_store.calm_candidates(lat_f, lon_f, day=day_i, hour=hour_i)}


def _route_cost(q):
    """Resolve the request's query params into (multiplier, cache_key, factors).

    Returns a tuple, or a JSONResponse error. multiplier is None for 'shortest'
    (the registry handles it); factors describes the active sensory selection.
    """
    profile = q.get("profile", "shortest")
    if profile == "shortest":
        return None, "shortest", {"profile": "shortest"}, {}, None
    if profile != "sensory":
        return error(400, "bad_request",
                     f"Unknown profile '{profile}'. Available: shortest, sensory.")

    noise = (q.get("noise") or "").strip().lower() in _TRUE
    light = (q.get("light") or "").strip().lower() or None
    crowd = (q.get("crowd") or "").strip().lower() in _TRUE
    if light is not None and light not in LIGHT_MODES:
        return error(400, "bad_request",
                     f"Unknown light mode '{light}'. Use one of: {', '.join(LIGHT_MODES)}.")
    strength = (q.get("strength") or "medium").strip().lower()
    if strength not in STRENGTH_WEIGHT:
        return error(400, "bad_request",
                     f"Unknown strength '{strength}'. Use: {', '.join(STRENGTH_WEIGHT)}.")

    avail = available_factors()
    if noise and not avail.get("noise"):
        return error(400, "bad_request", "Noise data is not loaded. Run etl/build_noise.py.")
    if light and not avail.get("light"):
        return error(400, "bad_request", "Lighting data is not available in this dataset.")
    if crowd and not avail.get("crowd"):
        return error(400, "bad_request",
                     "Crowd data needs a BestTime API key (set BESTTIME_API_KEY_PRIVATE).")

    # Optional "Leave at" time: when_day (0=Mon..6=Sun) and when_hour (0..23),
    # computed client-side in Kraków local time. Absent -> route for "now".
    when_day, when_hour = _parse_when(q)

    crowd_override = None
    if crowd:
        cur_day, cur_hour = _krakow_now()
        if when_hour is not None and (when_day, when_hour) != (cur_day, cur_hour):
            # A specific future hour: build a one-off crowd layer for it (cached)
            # without touching the shared "now" snapshot.
            crowd_override = CROWD.layer_for(GRAPH, when_day, when_hour)
            if crowd_override is None:
                # We could not get crowd data for that time (e.g. BestTime quota).
                # Honest: unknown everywhere for that hour — NEVER reuse "now"
                # data under a future-time label (UNC-07, UNC-01).
                n = len(GRAPH.edges)
                crowd_override = (np.zeros(n), np.zeros(n, dtype=bool))
        else:
            # "Now": ensure the shared snapshot is current-ish.
            if not CROWD.loaded or CROWD.is_stale():
                _refresh_crowd_async()

    multiplier, factor_known = sensory_cost(
        GRAPH.edges, noise=noise, light=light, crowd=crowd, strength=strength,
        crowd_data=crowd_override,
    )
    if crowd and crowd_override is not None:
        crowd_key = f"c=1@d{when_day}h{when_hour}"
    elif crowd:
        crowd_key = f"c=1@{CROWD.epoch}"
    else:
        crowd_key = "c=0"
    when_key = f"|w={when_day}:{when_hour}" if when_hour is not None else ""
    cache_key = f"sensory|n={int(noise)}|l={light}|{crowd_key}|s={strength}{when_key}"
    factors = {"profile": "sensory", "noise": noise, "light": light,
               "crowd": crowd, "strength": strength}
    return multiplier, cache_key, factors, factor_known, crowd_override


def _summarise(eids, factors, factor_known, crowd_override=None):
    """Per-factor exposure + uncertainty stats and the uncertain sub-paths."""
    eids = np.asarray(eids, dtype="int64")
    seg_len = GRAPH.edge_length[eids]
    total = float(seg_len.sum()) or 1.0
    exposure: dict = {}
    uncertainty: dict = {}
    uncertain = np.zeros(len(eids), dtype=bool)
    parts: list[str] = []

    if factors.get("noise"):
        db = pd.to_numeric(GRAPH.edges["noise_lden_db"], errors="coerce").to_numpy()[eids]
        known = factor_known["noise"][eids]
        kl = float(seg_len[known].sum())
        mean_db = float((db[known] * seg_len[known]).sum() / kl) if kl > 0 else None
        loud = float(seg_len[known & (db >= LOUD_DB)].sum())
        unk = float(seg_len[~known].sum())
        exposure["noise"] = {
            "mean_lden_db": round(mean_db, 1) if mean_db is not None else None,
            "loud_pct": round(loud / total * 100, 1),
        }
        uncertainty["noise"] = {"unknown_pct": round(unk / total * 100, 1),
                                "unknown_m": round(unk, 1)}
        uncertain |= ~known
        if mean_db is not None:
            parts.append(f"avg {mean_db:.0f} dB, {loud / total * 100:.0f}% loud")

    if factors.get("light"):
        is_lit, is_unlit = profiles._lit_state(GRAPH.edges.iloc[eids])
        known = factor_known["light"][eids]
        lit_pct = float(seg_len[is_lit].sum()) / total * 100
        unlit_pct = float(seg_len[is_unlit].sum()) / total * 100
        unk = float(seg_len[~known].sum())
        exposure["light"] = {"lit_pct": round(lit_pct, 1), "unlit_pct": round(unlit_pct, 1)}
        uncertainty["light"] = {"unknown_pct": round(unk / total * 100, 1),
                                "unknown_m": round(unk, 1)}
        uncertain |= ~known
        label = "well-lit" if factors["light"] == "prefer_lit" else "dark"
        val = lit_pct if factors["light"] == "prefer_lit" else (100 - lit_pct)
        parts.append(f"{val:.0f}% {label}, {unk / total * 100:.0f}% unknown lighting")

    if factors.get("crowd"):
        if crowd_override is not None:
            pen = np.asarray(crowd_override[0], dtype="float64")[eids]
        elif "crowd_penalty" in GRAPH.edges.columns:
            pen = pd.to_numeric(GRAPH.edges.get("crowd_penalty"), errors="coerce").to_numpy()[eids]
        else:
            pen = np.zeros(len(eids))
        known = factor_known["crowd"][eids]
        busy = float(seg_len[known & (pen >= 0.5)].sum())
        unk = float(seg_len[~known].sum())
        exposure["crowd"] = {"busy_pct": round(busy / total * 100, 1)}
        uncertainty["crowd"] = {"unknown_pct": round(unk / total * 100, 1),
                                "unknown_m": round(unk, 1)}
        uncertain |= ~known
        parts.append(f"{busy / total * 100:.0f}% busy, {unk / total * 100:.0f}% no crowd data")

    # Group consecutive uncertain edges into sub-paths for a dashed map overlay.
    uncertain_segments: list[list] = []
    cur: list = []
    for i, eid in enumerate(eids):
        if uncertain[i]:
            seg = GRAPH.edge_coords[int(eid)]
            cur.extend(seg[1:] if cur else seg)
        elif cur:
            uncertain_segments.append(cur)
            cur = []
    if cur:
        uncertain_segments.append(cur)

    return exposure, uncertainty, uncertain_segments, parts


@app.get("/route")
def route(request: Request):
    if GRAPH is None:
        return error(503, "not_ready", _LOAD_ERROR or "Data not loaded.")
    q = request.query_params

    resolved = _route_cost(q)
    if isinstance(resolved, JSONResponse):
        return resolved
    multiplier, cache_key, factors, factor_known, crowd_override = resolved

    try:
        from_lat, from_lon = parse_point(q.get("from"), "from")
        to_lat, to_lon = parse_point(q.get("to"), "to")
    except ValueError as exc:
        return error(400, "bad_request", str(exc))

    for lat, lon, label in ((from_lat, from_lon, "from"), (to_lat, to_lon, "to")):
        if not GRAPH.in_bbox(lat, lon):
            return error(422, "out_of_area",
                         f"The '{label}' point is outside the covered Kraków area.")

    src_idx, src_dist = GRAPH.nearest_node(from_lat, from_lon)
    dst_idx, dst_dist = GRAPH.nearest_node(to_lat, to_lon)
    for dist, label in ((src_dist, "from"), (dst_dist, "to")):
        if dist > 500.0:
            return error(422, "out_of_area",
                         f"The '{label}' point is {dist:.0f} m from the nearest path, "
                         f"which is too far (max 500 m). Pick a point closer to a street.")

    result = GRAPH.route(src_idx, dst_idx, multiplier=multiplier, cache_key=cache_key) \
        if multiplier is not None else GRAPH.route(src_idx, dst_idx, "shortest")
    if result is None:
        return error(404, "no_route", "No walking route found between these two points.")

    length_m = result["length_m"]
    duration_min = round(length_m / 1000.0 / WALK_SPEED_KMH * 60.0)
    km = length_m / 1000.0

    exposure, uncertainty, uncertain_segments, parts = _summarise(
        result["edge_ids"], factors, factor_known, crowd_override
    )
    summary = f"About {km:.1f} km, roughly {duration_min} minutes on foot."
    if parts:
        summary += " " + "; ".join(parts) + "."

    return {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": result["coordinates"]},
        "properties": {
            "profile": factors.get("profile", "shortest"),
            "factors": factors,
            "length_m": round(length_m, 1),
            "duration_min_estimate": duration_min,
            "edge_count": result["edge_count"],
            "summary": summary,
            "exposure": exposure,
            "uncertainty": uncertainty,
            "data_built_at": GRAPH.data_built_at,
        },
        "uncertain_segments": uncertain_segments,
    }
