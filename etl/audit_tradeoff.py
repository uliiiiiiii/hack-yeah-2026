"""Audit: how much exposure can routing avoid, and at what cost in extra distance?

Run from etl/ after build_edges.py:
    python audit_tradeoff.py                 # uses a crude road-class PLACEHOLDER penalty
    python audit_tradeoff.py --penalty-col noise_penalty   # once edges.parquet has a real 0..1 column

Cost per edge = length_m * (1 + w * penalty). For each random origin/destination pair we compare
the shortest route (w = 0) with penalised routes, and report:
  - median extra distance (%)
  - median exposure reduction (%), exposure = sum(length_m * penalty) along the route
  - share of pairs with at least 10% exposure reduction

PLACEHOLDER results only test the pipeline. They say nothing about real noise.
"""
import argparse
from pathlib import Path

import numpy as np
import pandas as pd
import scipy.sparse as sp
from scipy.sparse.csgraph import dijkstra

DATA = Path(__file__).resolve().parent.parent / "data"

# Crude stand-in so the script runs before real noise data exists. NOT a finding.
PLACEHOLDER = {
    "trunk": 1.0, "primary": 1.0, "secondary": 0.8, "tertiary": 0.6,
    "unclassified": 0.4, "residential": 0.3, "service": 0.3,
    "living_street": 0.15, "pedestrian": 0.1, "footway": 0.1,
    "path": 0.05, "cycleway": 0.1, "steps": 0.1, "track": 0.05,
}


def build_matrix(edges: pd.DataFrame, cost: np.ndarray, n_nodes: int):
    """CSR matrix of min-cost edges + lookup of (u, v) -> (length, exposure) for the chosen edges."""
    df = edges[["u_idx", "v_idx", "length_m", "penalty"]].copy()
    df["cost"] = cost
    df = df.sort_values("cost").drop_duplicates(["u_idx", "v_idx"], keep="first")  # parallel edges
    mat = sp.csr_matrix(
        (df["cost"].to_numpy(), (df["u_idx"].to_numpy(), df["v_idx"].to_numpy())),
        shape=(n_nodes, n_nodes),
    )
    lookup = dict(
        zip(
            zip(df["u_idx"].to_numpy(), df["v_idx"].to_numpy()),
            zip(df["length_m"].to_numpy(), (df["length_m"] * df["penalty"]).to_numpy()),
        )
    )
    return mat, lookup


def route_stats(mat, lookup, src: int, dst: int):
    dist, pred = dijkstra(mat, directed=True, indices=src, return_predecessors=True)
    if not np.isfinite(dist[dst]):
        return None
    length = exposure = 0.0
    node = dst
    while node != src:
        prev = pred[node]
        seg_len, seg_exp = lookup[(prev, node)]
        length += seg_len
        exposure += seg_exp
        node = prev
    return length, exposure


def sample_pairs(nodes: pd.DataFrame, n_pairs: int, rng, dmin=500, dmax=3000):
    lat0 = np.deg2rad(nodes["lat"].mean())
    x = nodes["lon"].to_numpy() * 111_320 * np.cos(lat0)
    y = nodes["lat"].to_numpy() * 110_540
    idx = nodes["node_idx"].to_numpy()
    pairs = []
    tries = 0
    while len(pairs) < n_pairs and tries < n_pairs * 50:
        tries += 1
        i = rng.integers(len(nodes))
        d = np.hypot(x - x[i], y - y[i])
        cand = np.flatnonzero((d >= dmin) & (d <= dmax))
        if len(cand):
            pairs.append((int(idx[i]), int(idx[rng.choice(cand)])))
    return pairs


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--penalty-col", default=None, help="edges.parquet column with 0..1 penalty")
    ap.add_argument("--pairs", type=int, default=50)
    ap.add_argument("--seed", type=int, default=1)
    args = ap.parse_args()

    edges = pd.read_parquet(DATA / "edges.parquet", columns=None)
    nodes = pd.read_parquet(DATA / "nodes.parquet")

    if args.penalty_col:
        penalty = edges[args.penalty_col].astype(float).fillna(0.0).clip(0, 1)
        label = f"REAL column '{args.penalty_col}' (nulls treated as 0 here: unknown is NOT quiet, see note)"
    else:
        hw = edges["highway"].astype(str).str.split(";").str[0]
        penalty = hw.map(PLACEHOLDER).fillna(0.3)
        label = "PLACEHOLDER road-class penalty (pipeline test only, not a finding)"
    edges = edges.assign(penalty=penalty.to_numpy())
    print(f"Penalty source: {label}\n")

    n_nodes = int(nodes["node_idx"].max()) + 1
    base_mat, base_lookup = build_matrix(edges, edges["length_m"].to_numpy(), n_nodes)

    rng = np.random.default_rng(args.seed)
    pairs = sample_pairs(nodes, args.pairs, rng)
    print(f"Sampled {len(pairs)} origin/destination pairs, 500-3000 m apart\n")

    shortest = {}
    for s, t in pairs:
        r = route_stats(base_mat, base_lookup, s, t)
        if r is not None:
            shortest[(s, t)] = r

    rows = []
    for w in (1, 3, 8):
        cost = edges["length_m"].to_numpy() * (1 + w * edges["penalty"].to_numpy())
        mat, lookup = build_matrix(edges, cost, n_nodes)
        extra, reduction = [], []
        for (s, t), (len_s, exp_s) in shortest.items():
            r = route_stats(mat, lookup, s, t)
            if r is None:
                continue
            len_q, exp_q = r
            extra.append((len_q / len_s - 1) * 100)
            if exp_s > 0:
                reduction.append((1 - exp_q / exp_s) * 100)
        rows.append(
            {
                "weight": w,
                "pairs": len(extra),
                "median_extra_distance_pct": round(float(np.median(extra)), 1),
                "median_exposure_reduction_pct": round(float(np.median(reduction)), 1) if reduction else np.nan,
                "share_pairs_ge10pct_reduction": round(float(np.mean(np.array(reduction) >= 10)), 2) if reduction else np.nan,
            }
        )

    out = pd.DataFrame(rows)
    out.to_csv(DATA / "audit_tradeoff.csv", index=False)
    print(out.to_string(index=False))
    print(f"\nSaved {DATA / 'audit_tradeoff.csv'}")
    print(
        "Read it as: at weight w, how much longer is the typical route, and how much less exposure does it get? "
        "A big reduction for a small detour means routing has real room to help."
    )


if __name__ == "__main__":
    main()
