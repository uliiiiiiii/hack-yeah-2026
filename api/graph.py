"""Load the parquet contracts and answer routing queries.

The edge table is the single source of truth. A profile turns edge columns into a
per-edge cost multiplier (see profiles.py); cost = length_m * multiplier. Cost
matrices are built lazily per profile and cached.
"""
import json
import math
from dataclasses import dataclass
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import scipy.sparse as sp
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree

from profiles import PROFILES

# meters per degree of latitude (and of longitude once scaled by cos(lat)).
M_PER_DEG = 111_320.0
MAX_SNAP_M = 500.0       # reject points further than this from any node
BBOX_MARGIN_DEG = 0.02   # ~2 km tolerance around the graph's bounding box


class GraphError(Exception):
    """Raised when the data files needed to serve routes are missing or invalid."""


@dataclass
class ProfileMatrix:
    matrix: sp.csr_matrix
    # (u_idx, v_idx) -> edge_idx of the cheapest edge kept for that node pair.
    edge_of_pair: dict


class Graph:
    def __init__(self, data_dir: Path):
        self.data_dir = Path(data_dir)
        self._load()
        self._build_index()
        self._profile_cache: dict[str, ProfileMatrix] = {}

    # ---- loading -------------------------------------------------------------
    def _load(self) -> None:
        nodes_path = self.data_dir / "nodes.parquet"
        edges_path = self.data_dir / "edges.parquet"
        info_path = self.data_dir / "build_info.json"
        missing = [p.name for p in (nodes_path, edges_path, info_path) if not p.exists()]
        if missing:
            raise GraphError(
                f"Missing data file(s): {', '.join(missing)} in {self.data_dir}. "
                "Build them first:\n"
                "    cd etl && .venv/bin/python build_graph.py && .venv/bin/python build_edges.py"
            )

        self.nodes = pd.read_parquet(nodes_path)
        self.edges = gpd.read_parquet(edges_path)
        self.build_info = json.loads(info_path.read_text())
        self.data_built_at = self.build_info.get("data_built_at")

        self.n_nodes = int(self.nodes["node_idx"].max()) + 1

        # Precompute per-edge coordinate lists (oriented u->v) and lengths.
        self.edge_length = self.edges["length_m"].to_numpy(dtype="float64")
        self.u_idx = self.edges["u_idx"].to_numpy(dtype="int64")
        self.v_idx = self.edges["v_idx"].to_numpy(dtype="int64")
        self.edge_coords = [list(geom.coords) for geom in self.edges.geometry]

    def _build_index(self) -> None:
        lat = self.nodes["lat"].to_numpy(dtype="float64")
        lon = self.nodes["lon"].to_numpy(dtype="float64")
        self.node_lat = lat
        self.node_lon = lon
        self.mean_lat = float(lat.mean())
        self._cos_lat = math.cos(math.radians(self.mean_lat))
        # KDTree in a latitude-scaled degree space so Euclidean distance ~ metric.
        scaled = np.column_stack([lon * self._cos_lat, lat])
        self._tree = cKDTree(scaled)
        self._node_idx_by_row = self.nodes["node_idx"].to_numpy(dtype="int64")

        self.min_lat, self.max_lat = float(lat.min()), float(lat.max())
        self.min_lon, self.max_lon = float(lon.min()), float(lon.max())

    # ---- geocoding helpers ---------------------------------------------------
    def in_bbox(self, lat: float, lon: float) -> bool:
        return (
            self.min_lat - BBOX_MARGIN_DEG <= lat <= self.max_lat + BBOX_MARGIN_DEG
            and self.min_lon - BBOX_MARGIN_DEG <= lon <= self.max_lon + BBOX_MARGIN_DEG
        )

    def nearest_node(self, lat: float, lon: float) -> tuple[int, float]:
        """Return (node_idx, distance_m) of the nearest graph node."""
        dist_deg, row = self._tree.query([lon * self._cos_lat, lat])
        dist_m = float(dist_deg) * M_PER_DEG
        return int(self._node_idx_by_row[row]), dist_m

    # ---- routing -------------------------------------------------------------
    def _profile_matrix(self, profile: str) -> ProfileMatrix:
        if profile in self._profile_cache:
            return self._profile_cache[profile]

        multiplier = PROFILES[profile](self.edges)
        multiplier = np.asarray(multiplier, dtype="float64")
        if multiplier.shape[0] != len(self.edges):
            raise GraphError(f"Profile '{profile}' returned {multiplier.shape[0]} "
                             f"multipliers for {len(self.edges)} edges.")
        cost = self.edge_length * multiplier  # inf stays inf -> excluded below

        df = pd.DataFrame({
            "u": self.u_idx,
            "v": self.v_idx,
            "cost": cost,
            "edge_idx": np.arange(len(self.edges), dtype="int64"),
        })
        df = df[np.isfinite(df["cost"].to_numpy())]  # drop hard-excluded edges
        # Reduce parallel edges to the cheapest BEFORE building the CSR matrix,
        # because csr_matrix construction SUMS duplicate (u, v) entries.
        df = df.sort_values("cost").drop_duplicates(["u", "v"], keep="first")

        matrix = sp.csr_matrix(
            (df["cost"].to_numpy(), (df["u"].to_numpy(), df["v"].to_numpy())),
            shape=(self.n_nodes, self.n_nodes),
        )
        edge_of_pair = dict(zip(
            zip(df["u"].to_numpy(), df["v"].to_numpy()),
            df["edge_idx"].to_numpy(),
        ))
        pm = ProfileMatrix(matrix=matrix, edge_of_pair=edge_of_pair)
        self._profile_cache[profile] = pm
        return pm

    def route(self, src_idx: int, dst_idx: int, profile: str) -> dict | None:
        """Shortest-cost path from src to dst. Returns None if unreachable."""
        pm = self._profile_matrix(profile)
        dist, pred = dijkstra(
            pm.matrix, directed=True, indices=src_idx, return_predecessors=True
        )
        if src_idx != dst_idx and not np.isfinite(dist[dst_idx]):
            return None

        # Reconstruct the node path dst -> src, then reverse.
        path_nodes = [dst_idx]
        node = dst_idx
        while node != src_idx:
            node = int(pred[node])
            if node < 0:  # defensive: no predecessor
                return None
            path_nodes.append(node)
        path_nodes.reverse()

        coords: list[tuple[float, float]] = []
        total_length = 0.0
        edge_count = 0
        for a, b in zip(path_nodes[:-1], path_nodes[1:]):
            edge_idx = pm.edge_of_pair[(a, b)]
            total_length += float(self.edge_length[edge_idx])
            seg = self.edge_coords[edge_idx]
            if coords:
                seg = seg[1:]  # drop duplicated join point
            coords.extend(seg)
            edge_count += 1

        return {
            "coordinates": coords,
            "length_m": total_length,
            "edge_count": edge_count,
        }
