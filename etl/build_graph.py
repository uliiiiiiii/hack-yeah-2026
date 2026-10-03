"""Download the Kraków walking network and save it as GraphML.

Run from etl/:
    python build_graph.py            # skips download if data/krakow_walk.graphml exists
    python build_graph.py --force    # re-download even if the file exists

OSMnx drops most OSM tags by default, so we widen the tag sets BEFORE downloading.
Geocoding can occasionally return the wrong polygon, so we print the polygon area
and fall back to an explicit bounding box if it is implausible for Kraków.
"""
import argparse
import sys
from pathlib import Path

import osmnx as ox

DATA = Path(__file__).resolve().parent.parent / "data"
GRAPHML = DATA / "krakow_walk.graphml"

PLACE = "Kraków, Poland"
# Kraków is roughly 327 km². If geocoding returns something wildly different we
# fall back to this explicit bbox (west, south, east, north) that covers the city.
KRAKOW_AREA_KM2 = 327.0
AREA_TOLERANCE = 0.5  # accept geocoded polygon within ±50% of the expected area
KRAKOW_BBOX = (19.79, 49.97, 20.22, 50.13)  # (left, bottom, right, top) = (W, S, E, N)

# OSMnx keeps only these tags unless we extend the lists.
USEFUL_TAGS_WAY = [
    "highway", "surface", "smoothness", "incline", "width", "lit",
    "maxspeed", "wheelchair", "step_count", "name", "oneway",
    "access", "service", "bridge", "tunnel",
]
USEFUL_TAGS_NODE = ["highway", "crossing", "kerb"]


def polygon_area_km2(gdf) -> float:
    """Area of a geocoded boundary polygon in km², via an equal-area projection."""
    projected = gdf.to_crs(gdf.estimate_utm_crs())
    return float(projected.geometry.area.sum() / 1e6)


def download_graph():
    """Return an OSMnx walk graph for Kraków, using bbox fallback if geocoding is off."""
    try:
        boundary = ox.geocode_to_gdf(PLACE)
        area = polygon_area_km2(boundary)
        print(f"Geocoded '{PLACE}': polygon area ≈ {area:,.0f} km² "
              f"(expected ≈ {KRAKOW_AREA_KM2:.0f} km²)")
    except Exception as exc:  # geocoding failed entirely
        area = None
        print(f"WARNING: geocoding failed ({exc}); will use bounding-box fallback.")

    lo = KRAKOW_AREA_KM2 * (1 - AREA_TOLERANCE)
    hi = KRAKOW_AREA_KM2 * (1 + AREA_TOLERANCE)
    if area is not None and lo <= area <= hi:
        print("Polygon area is plausible; downloading by place name.")
        return ox.graph_from_place(PLACE, network_type="walk")

    print(f"FALLBACK: polygon area {area} km² is outside [{lo:.0f}, {hi:.0f}] km² "
          f"(or missing). Downloading by explicit bounding box {KRAKOW_BBOX}.")
    return ox.graph_from_bbox(bbox=KRAKOW_BBOX, network_type="walk")


def network_length_km(G) -> float:
    total_m = sum(d.get("length", 0.0) for _, _, d in G.edges(data=True))
    return total_m / 1000.0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="re-download even if the graphml exists")
    args = ap.parse_args()

    DATA.mkdir(parents=True, exist_ok=True)

    # Mandatory: widen the tag sets so build_edges can see them.
    ox.settings.useful_tags_way = sorted(set(ox.settings.useful_tags_way) | set(USEFUL_TAGS_WAY))
    ox.settings.useful_tags_node = sorted(set(ox.settings.useful_tags_node) | set(USEFUL_TAGS_NODE))

    if GRAPHML.exists() and not args.force:
        print(f"{GRAPHML} already exists; skipping download (use --force to re-download).")
        return 0

    print(f"OSMnx {ox.__version__}: downloading the Kraków walking network…")
    try:
        G = download_graph()
    except Exception as exc:
        print(f"ERROR: download failed: {exc}", file=sys.stderr)
        return 1

    n_nodes, n_edges = G.number_of_nodes(), G.number_of_edges()
    print(f"Downloaded graph: {n_nodes:,} nodes, {n_edges:,} edges, "
          f"{network_length_km(G):,.1f} km of walking network.")

    if n_nodes < 1000:
        print(f"ERROR: only {n_nodes} nodes — this is far too small for Kraków. "
              f"Refusing to save.", file=sys.stderr)
        return 1

    ox.save_graphml(G, GRAPHML)
    print(f"Saved {GRAPHML}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
