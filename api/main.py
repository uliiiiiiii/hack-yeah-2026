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

app = FastAPI(title="Kraków walking-route API")

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
    allow_methods=["GET"],
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
