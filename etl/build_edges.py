"""Convert the saved GraphML into the two parquet contracts the API reads.

Run from etl/ (after build_graph.py):
    python build_edges.py

Produces:
    data/nodes.parquet   — one row per graph node (contiguous node_idx)
    data/edges.parquet   — GeoParquet, one row per directed edge (EPSG:4326)
    data/build_info.json — build timestamp, counts, OSMnx version

Principle 4: missing OSM tags stay missing (null). We never fill or parse them.
List-valued tags are only normalised by joining with ";".
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import osmnx as ox
import pandas as pd
from shapely.geometry import LineString

DATA = Path(__file__).resolve().parent.parent / "data"
GRAPHML = DATA / "krakow_walk.graphml"

# Raw OSM tag columns to carry through, cast to nullable string, never parsed.
EDGE_TAG_COLS = [
    "name", "highway", "surface", "smoothness", "incline",
    "width", "lit", "maxspeed", "wheelchair", "step_count",
]
NODE_TAG_COLS = ["highway", "crossing", "kerb"]


def join_lists(value):
    """Normalise OSMnx list-valued tags to a ';'-joined string; keep nulls as nulls."""
    if isinstance(value, (list, tuple)):
        return ";".join(str(v) for v in value)
    return value


def to_nullable_string(df: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    """Ensure each column exists, normalise list values, cast to pandas nullable 'string'."""
    for col in cols:
        if col not in df.columns:
            df[col] = pd.NA
        df[col] = df[col].map(join_lists)
        # Turn real missing values into <NA>; do not invent defaults.
        df[col] = df[col].astype("string")
        df.loc[df[col].str.strip() == "", col] = pd.NA
    return df


def orient_u_to_v(geom: LineString, ux: float, uy: float, vx: float, vy: float) -> LineString:
    """Return geom oriented so it starts at u and ends at v, reversing if needed."""
    sx, sy = geom.coords[0]
    ex, ey = geom.coords[-1]
    d_start_u = (sx - ux) ** 2 + (sy - uy) ** 2
    d_start_v = (sx - vx) ** 2 + (sy - vy) ** 2
    # If the start point is closer to v than to u, the line runs v->u; reverse it.
    if d_start_v < d_start_u:
        return LineString(list(geom.coords)[::-1])
    return geom


def main() -> int:
    if not GRAPHML.exists():
        print(f"ERROR: {GRAPHML} not found. Run build_graph.py first.", file=sys.stderr)
        return 1

    print(f"Loading {GRAPHML} …")
    G = ox.load_graphml(GRAPHML)
    nodes_gdf, edges_gdf = ox.graph_to_gdfs(G, nodes=True, edges=True)

    # ---- nodes ----
    nodes = nodes_gdf.reset_index()  # brings 'osmid' out of the index
    osm_id_col = "osmid" if "osmid" in nodes.columns else "index"
    nodes = nodes.rename(columns={osm_id_col: "osm_id", "y": "lat", "x": "lon"})
    nodes["node_idx"] = range(len(nodes))
    nodes = to_nullable_string(nodes, NODE_TAG_COLS)
    nodes_out = nodes[["node_idx", "osm_id", "lat", "lon", *NODE_TAG_COLS]].copy()
    nodes_out["osm_id"] = nodes_out["osm_id"].astype("int64")
    nodes_out["lat"] = nodes_out["lat"].astype("float64")
    nodes_out["lon"] = nodes_out["lon"].astype("float64")

    osmid_to_idx = dict(zip(nodes_out["osm_id"].to_numpy(), nodes_out["node_idx"].to_numpy()))
    node_xy = dict(zip(
        nodes_out["node_idx"].to_numpy(),
        zip(nodes_out["lon"].to_numpy(), nodes_out["lat"].to_numpy()),
    ))

    # ---- edges ----
    edges = edges_gdf.reset_index()  # brings u, v, key out of the MultiIndex
    edges["u_idx"] = edges["u"].map(osmid_to_idx)
    edges["v_idx"] = edges["v"].map(osmid_to_idx)
    missing = edges["u_idx"].isna() | edges["v_idx"].isna()
    if missing.any():
        print(f"WARNING: dropping {int(missing.sum())} edges whose endpoints are not in the node set.")
        edges = edges[~missing].copy()
    edges["u_idx"] = edges["u_idx"].astype("int64")
    edges["v_idx"] = edges["v_idx"].astype("int64")

    edges["length_m"] = edges["length"].astype("float64")
    edges = to_nullable_string(edges, EDGE_TAG_COLS)

    # Orient every geometry from u to v.
    oriented = []
    for u_idx, v_idx, geom in zip(edges["u_idx"], edges["v_idx"], edges["geometry"]):
        ux, uy = node_xy[u_idx]
        vx, vy = node_xy[v_idx]
        oriented.append(orient_u_to_v(geom, ux, uy, vx, vy))
    edges["geometry"] = oriented

    edges = edges.reset_index(drop=True)
    edges["edge_idx"] = range(len(edges))

    keep = ["edge_idx", "u_idx", "v_idx", "length_m", *EDGE_TAG_COLS, "geometry"]
    edges_out = edges[keep].set_geometry("geometry")
    edges_out = edges_out.set_crs("EPSG:4326", allow_override=True)

    # ---- write ----
    DATA.mkdir(parents=True, exist_ok=True)
    nodes_path = DATA / "nodes.parquet"
    edges_path = DATA / "edges.parquet"
    nodes_out.to_parquet(nodes_path, index=False)
    edges_out.to_parquet(edges_path, index=False)  # GeoParquet via geopandas

    build_info = {
        "data_built_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "node_count": int(len(nodes_out)),
        "edge_count": int(len(edges_out)),
        "osmnx_version": ox.__version__,
    }
    (DATA / "build_info.json").write_text(json.dumps(build_info, indent=2) + "\n")

    total_km = edges_out["length_m"].sum() / 1000.0
    print(f"nodes.parquet: {len(nodes_out):,} nodes")
    print(f"edges.parquet: {len(edges_out):,} edges, {total_km:,.1f} km of walking network")
    print(f"build_info.json: {build_info}")

    if len(nodes_out) < 1000 or len(edges_out) < 1000:
        print("ERROR: counts look implausibly small for Kraków.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
