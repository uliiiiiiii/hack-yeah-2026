"""Build a tiny synthetic graph on disk so tests never touch the real Kraków data.

Layout (node_idx : lat, lon), a small diamond with a parallel edge and a detour:

        1
       / \\
      0   3
       \\ /
        2

Edges (directed, both ways) with a cheap and an expensive parallel 0->1.
Coordinates are near Kraków so the bbox check passes.
"""
import importlib
import json
from pathlib import Path

import geopandas as gpd
import pandas as pd
import pytest
from shapely.geometry import LineString

# Nodes placed a few hundred metres apart around ~50.06, 19.94.
NODES = [
    # node_idx, osm_id, lat,      lon
    (0, 1000, 50.0600, 19.9400),
    (1, 1001, 50.0630, 19.9430),
    (2, 1002, 50.0570, 19.9430),
    (3, 1003, 50.0600, 19.9460),
    (4, 1004, 50.0600, 19.9600),  # isolated-ish node, far corner (reached via 5 only)
    (5, 1005, 50.0605, 19.9600),  # connected only to 4, so {4,5} is a separate component
]

# (u, v, length_m, highway). We add both directions for walkable edges.
# Two parallel 0<->1 edges: a long cheap-by-length one and a short one.
BASE_EDGES = [
    (0, 1, 400.0, "footway"),   # parallel A (longer)
    (0, 1, 300.0, "footway"),   # parallel B (shorter) -> should win
    (0, 2, 350.0, "footway"),
    (1, 3, 350.0, "footway"),
    (2, 3, 500.0, "footway"),   # detour side
    (4, 5, 60.0, "footway"),    # disconnected component
]


def _linestring(nodes_by_idx, u, v):
    la_u, lo_u = nodes_by_idx[u]
    la_v, lo_v = nodes_by_idx[v]
    return LineString([(lo_u, la_u), (lo_v, la_v)])  # (lon, lat), oriented u->v


def write_synthetic_data(data_dir: Path) -> None:
    data_dir.mkdir(parents=True, exist_ok=True)

    nodes_df = pd.DataFrame(NODES, columns=["node_idx", "osm_id", "lat", "lon"])
    for col in ("highway", "crossing", "kerb"):
        nodes_df[col] = pd.NA
        nodes_df[col] = nodes_df[col].astype("string")
    nodes_df.to_parquet(data_dir / "nodes.parquet", index=False)

    nodes_by_idx = {idx: (lat, lon) for idx, _osm, lat, lon in NODES}
    rows = []
    for u, v, length, hw in BASE_EDGES:
        for a, b in ((u, v), (v, u)):  # both directions
            rows.append({
                "u_idx": a, "v_idx": b, "length_m": length, "highway": hw,
                "geometry": _linestring(nodes_by_idx, a, b),
            })
    edges_df = pd.DataFrame(rows)
    edges_df["edge_idx"] = range(len(edges_df))
    tag_cols = ["name", "surface", "smoothness", "incline", "width",
                "lit", "maxspeed", "wheelchair", "step_count"]
    for col in tag_cols:
        edges_df[col] = pd.NA
        edges_df[col] = edges_df[col].astype("string")
    edges_df["highway"] = edges_df["highway"].astype("string")
    cols = ["edge_idx", "u_idx", "v_idx", "length_m", "name", "highway",
            "surface", "smoothness", "incline", "width", "lit", "maxspeed",
            "wheelchair", "step_count", "geometry"]
    gdf = gpd.GeoDataFrame(edges_df[cols], geometry="geometry", crs="EPSG:4326")
    gdf.to_parquet(data_dir / "edges.parquet", index=False)

    (data_dir / "build_info.json").write_text(json.dumps({
        "data_built_at": "2026-01-01T00:00:00Z",
        "node_count": len(NODES),
        "edge_count": len(gdf),
        "osmnx_version": "test",
    }))

    # Sensory overlay: make the 0<->1 edges loud (80 dB) and everything else quiet
    # (52 dB), with noise known for all. Lighting is left all-unknown (lit=NA) so
    # the light factor exercises the uncertainty path.
    loud_pairs = {(0, 1), (1, 0)}
    noise_db = [
        80.0 if (int(r.u_idx), int(r.v_idx)) in loud_pairs else 52.0
        for r in gdf.itertuples()
    ]
    overlay = pd.DataFrame({
        "edge_idx": gdf["edge_idx"].to_numpy(),
        "noise_lden_db": noise_db,
        "noise_known": True,
        "noise_band": pd.array(["80+" if d >= 80 else "<55" for d in noise_db], dtype="string"),
    })
    overlay.to_parquet(data_dir / "edge_sensory.parquet", index=False)


@pytest.fixture()
def graph(tmp_path):
    """A fresh Graph backed by synthetic data."""
    import graph as graph_module
    write_synthetic_data(tmp_path)
    return graph_module.Graph(tmp_path)


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """A TestClient whose app is loaded against synthetic data."""
    from fastapi.testclient import TestClient
    write_synthetic_data(tmp_path)
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    import main
    importlib.reload(main)  # re-run module-level Graph load with the test DATA_DIR
    return TestClient(main.app)
