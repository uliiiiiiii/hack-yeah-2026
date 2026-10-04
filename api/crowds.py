"""BestTime.app integration: turn current venue foot-traffic into a per-edge
"busy area" penalty that the sensory router can avoid.

Unlike noise/light (static, baked by the ETL), crowd data is *current*, so we
fetch it at runtime and refresh it periodically in memory. The BestTime API key
lives ONLY here, server-side (read from the environment) — it is never sent to
the web or mobile app.

Setup (done once by you):
  1. Put your key in the API environment:  BESTTIME_API_KEY_PRIVATE=...
     (see .env.example; the API loads the repo-root .env at startup).
  2. Seed Kraków venues into your BestTime account:  python etl/seed_besttime.py
     (uses the same key; populates venue foot-traffic forecasts to query later).

How "busy now" is computed:
  - GET /venues/filter for the Kraków area at the current day/hour → busy venues
    with coordinates + busyness (0..100), optionally live.
  - Each edge gets crowd_penalty 0..1 from nearby busy venues (distance-decayed).
  - crowd_known is True only where BestTime actually has venue coverage nearby;
    elsewhere the crowd factor is unknown (flagged), never assumed "quiet".
"""
import math
import os
import time
from dataclasses import dataclass, field

import numpy as np
import requests
from scipy.spatial import cKDTree

API_BASE = "https://besttime.app/api/v1"
FILTER_URL = f"{API_BASE}/venues/filter"

# Kraków area to query (city centre + radius covering the agglomeration).
KRAKOW_LAT, KRAKOW_LON = 50.0614, 19.9372
KRAKOW_RADIUS_M = 15000
# BestTime's /venues/filter returns venues from its whole database in the area
# (not just ones we seeded), but defaults to 20 per page. Raise it for city-wide
# coverage — this costs only a query credit, not forecast credits.
VENUE_LIMIT = 500

INFLUENCE_M = 150.0    # a busy venue raises crowding within ~150 m
COVERAGE_M = 250.0     # within this of a venue => we "know" the crowd level here
REFRESH_SECONDS = 20 * 60  # re-fetch current busyness at most this often
M_PER_DEG = 111_320.0


def api_key() -> str | None:
    return os.environ.get("BESTTIME_API_KEY_PRIVATE") or None


def configured() -> bool:
    return api_key() is not None


def _parse_busyness(venue: dict) -> float | None:
    """Read a 0..100 busyness for the queried hour window from a filter venue.

    The venues/filter response gives `day_raw` (hourly busyness values filtered to
    the hour_min..hour_max window). We take the peak of that window. Fallbacks:
    `day_info.day_mean/day_max`, then live fields. Returns None if nothing numeric.
    """
    dr = venue.get("day_raw")
    if isinstance(dr, list):
        nums = [x for x in dr if isinstance(x, (int, float))]
        if nums:
            return float(max(nums))
    info = venue.get("day_info") or {}
    for key in ("day_mean", "day_max"):
        v = info.get(key)
        if isinstance(v, (int, float)):
            return float(v)
    for key in ("venue_live_busyness", "venue_forecasted_busyness"):
        v = venue.get(key)
        if isinstance(v, (int, float)):
            return float(v)
    return None


def fetch_busy_venues(day_int: int, hour: int, *, live: bool = False,
                      busy_min: int = 0, timeout: float = 20.0) -> list[dict]:
    """Return [{lat, lon, busyness0_1}] for venues in Kraków at day/hour.

    busyness0_1 defaults to busy_min/100 when the response omits a numeric value
    (we at least know the venue passed the busy filter).
    """
    key = api_key()
    if not key:
        return []
    params = {
        "api_key_private": key,
        "lat": round(KRAKOW_LAT, 3),
        "lng": round(KRAKOW_LON, 3),
        "radius": KRAKOW_RADIUS_M,
        "day_int": day_int,
        "hour_min": hour,
        "hour_max": hour,
        "busy_min": busy_min,
        "busy_conf": "any",
        "limit": VENUE_LIMIT,
    }
    if live:
        params["live"] = "true"
    resp = requests.get(FILTER_URL, params=params, timeout=timeout)
    resp.raise_for_status()
    data = resp.json()
    venues = data.get("venues", data if isinstance(data, list) else [])
    out = []
    for v in venues:
        lat = v.get("venue_lat")
        lon = v.get("venue_lng", v.get("venue_lon"))  # BestTime uses venue_lng
        if lat is None or lon is None:
            continue
        b = _parse_busyness(v)
        busy01 = (b / 100.0) if b is not None else max(busy_min, 1) / 100.0
        out.append({"lat": float(lat), "lon": float(lon),
                    "busyness": float(min(max(busy01, 0.0), 1.5))})
    return out


def build_crowd_layer(graph, venues: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    """Per-edge (crowd_penalty 0..1, crowd_known) from busy venues.

    Penalty at an edge = max over nearby venues of busyness * linear distance
    decay within INFLUENCE_M. Known where any venue is within COVERAGE_M.
    """
    n_edges = len(graph.edges)
    penalty = np.zeros(n_edges, dtype="float64")
    known = np.zeros(n_edges, dtype=bool)
    if not venues:
        return penalty, known

    cos_lat = math.cos(math.radians(KRAKOW_LAT))
    # Edge midpoints (mean of u/v node coords) in a latitude-scaled metric space.
    mx = (graph.node_lon[graph.u_idx] + graph.node_lon[graph.v_idx]) / 2 * cos_lat
    my = (graph.node_lat[graph.u_idx] + graph.node_lat[graph.v_idx]) / 2
    edge_xy = np.column_stack([mx * M_PER_DEG, my * M_PER_DEG])

    vlat = np.array([v["lat"] for v in venues])
    vlon = np.array([v["lon"] for v in venues])
    vbusy = np.array([v["busyness"] for v in venues])
    venue_xy = np.column_stack([vlon * cos_lat * M_PER_DEG, vlat * M_PER_DEG])

    tree = cKDTree(venue_xy)
    # Coverage: any venue within COVERAGE_M -> we have data here.
    cov = tree.query_ball_point(edge_xy, r=COVERAGE_M)
    # Influence: venues within INFLUENCE_M contribute a decayed busyness.
    inf = tree.query_ball_point(edge_xy, r=INFLUENCE_M)
    for i in range(n_edges):
        if cov[i]:
            known[i] = True
        best = 0.0
        for vi in inf[i]:
            d = math.dist(edge_xy[i], venue_xy[vi])
            best = max(best, vbusy[vi] * max(0.0, 1.0 - d / INFLUENCE_M))
        penalty[i] = min(best, 1.0)
    return penalty, known


@dataclass
class CrowdState:
    """Holds the current crowd layer and refreshes it from BestTime on demand."""
    epoch: int = 0
    fetched_at: float = 0.0
    venue_count: int = 0
    last_error: str | None = None
    loaded: bool = False
    _busy: bool = field(default=False)
    # Cache of (penalty, known) per (day_int, hour) for "Leave at" times, so moving
    # a time picker doesn't re-spend a BestTime query credit for the same hour.
    _hour_cache: dict = field(default_factory=dict)

    def is_stale(self) -> bool:
        return (time.time() - self.fetched_at) > REFRESH_SECONDS

    def layer_for(self, graph, day_int: int, hour: int, *, live: bool = False
                  ) -> tuple[np.ndarray, np.ndarray] | None:
        """Per-edge (penalty, known) for a specific day/hour (for "Leave at").

        Does NOT mutate the shared graph columns. Cached per (day, hour). Returns
        None if crowds are not configured or the fetch failed (caller then falls
        back to "unknown everywhere", never to "quiet").
        """
        if not configured():
            return None
        key = (int(day_int), int(hour))
        if key in self._hour_cache:
            return self._hour_cache[key]
        try:
            venues = fetch_busy_venues(day_int, hour, live=live)
            layer = build_crowd_layer(graph, venues)
            self._hour_cache[key] = layer
            return layer
        except Exception as exc:
            self.last_error = f"{type(exc).__name__}: {exc}"
            return None

    def refresh(self, graph, *, now_day: int, now_hour: int, live: bool = False) -> None:
        """Fetch current busyness and update graph.edges crowd columns in place."""
        if self._busy or not configured():
            return
        self._busy = True
        try:
            venues = fetch_busy_venues(now_day, now_hour, live=live)
            penalty, known = build_crowd_layer(graph, venues)
            graph.edges["crowd_penalty"] = penalty
            graph.edges["crowd_known"] = known
            graph.invalidate_cost_cache("crowd")
            self.epoch += 1
            self.fetched_at = time.time()
            self.venue_count = len(venues)
            self.loaded = True
            self.last_error = None
        except Exception as exc:  # network / parse / auth
            self.last_error = f"{type(exc).__name__}: {exc}"
        finally:
            self._busy = False
