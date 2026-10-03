"""Routing API: serve walking routes from the parquet contracts.

Run from api/:
    uvicorn main:app --reload --port 8000

Endpoints:
    GET /route?from=lat,lon&to=lat,lon&profile=shortest
    GET /health
"""
import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from graph import Graph, GraphError
from profiles import PROFILES

WALK_SPEED_KMH = 5.0
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

# Loaded once at import so a broken data dir fails fast and clearly.
try:
    GRAPH: Graph | None = Graph(DATA_DIR)
    _LOAD_ERROR: str | None = None
except GraphError as exc:
    GRAPH = None
    _LOAD_ERROR = str(exc)


def error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": code, "message": message})


def parse_point(raw: str | None, name: str) -> tuple[float, float]:
    """Parse a 'lat,lon' query value. Raises ValueError with a human message."""
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


@app.get("/health")
def health():
    if GRAPH is None:
        return error(503, "not_ready", _LOAD_ERROR or "Data not loaded.")
    return {
        "status": "ok",
        "node_count": GRAPH.n_nodes,
        "edge_count": int(len(GRAPH.edges)),
        "data_built_at": GRAPH.data_built_at,
        "profiles": sorted(PROFILES.keys()),
    }


@app.get("/route")
def route(request: Request):
    if GRAPH is None:
        return error(503, "not_ready", _LOAD_ERROR or "Data not loaded.")

    q = request.query_params
    profile = q.get("profile", "shortest")
    if profile not in PROFILES:
        return error(400, "bad_request",
                     f"Unknown profile '{profile}'. Available: {', '.join(sorted(PROFILES))}.")

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

    result = GRAPH.route(src_idx, dst_idx, profile)
    if result is None:
        return error(404, "no_route",
                     "No walking route found between these two points.")

    length_m = result["length_m"]
    duration_min = round(length_m / 1000.0 / WALK_SPEED_KMH * 60.0)
    km = length_m / 1000.0
    summary = f"About {km:.1f} km, roughly {duration_min} minutes on foot."

    return {
        "type": "Feature",
        "geometry": {
            "type": "LineString",
            "coordinates": result["coordinates"],  # [lon, lat] order
        },
        "properties": {
            "profile": profile,
            "length_m": round(length_m, 1),
            "duration_min_estimate": duration_min,
            "edge_count": result["edge_count"],
            "summary": summary,
            "data_built_at": GRAPH.data_built_at,
        },
    }
