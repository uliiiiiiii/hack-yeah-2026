"""Audit: how much of Kraków's walking network has accessibility-relevant OSM tags?

Run from etl/ after build_edges.py:  python audit_physical.py

Coverage is measured by edge LENGTH (share of metres), not by edge count,
because OSM edges vary a lot in length.
"""
from pathlib import Path

import pandas as pd

DATA = Path(__file__).resolve().parent.parent / "data"
TAGS = ["surface", "smoothness", "incline", "width", "lit", "maxspeed", "wheelchair", "step_count"]


def has_value(series: pd.Series) -> pd.Series:
    return series.notna() & (series.astype(str).str.strip() != "")


def coverage(sub: pd.DataFrame, tag: str) -> float:
    total = sub["length_m"].sum()
    if total == 0:
        return float("nan")
    return float(sub.loc[has_value(sub[tag]), "length_m"].sum() / total)


def main() -> None:
    edges = pd.read_parquet(DATA / "edges.parquet")
    edges["hw"] = edges["highway"].astype(str).str.split(";").str[0]
    tags = [t for t in TAGS if t in edges.columns]
    missing_cols = [t for t in TAGS if t not in edges.columns]
    if missing_cols:
        print(f"WARNING: columns not in edges.parquet (check useful_tags_way): {missing_cols}\n")

    total_km = edges["length_m"].sum() / 1000
    print(f"Network: {len(edges):,} edges, {total_km:,.0f} km\n")

    rows = []
    overall = {"hw": "ALL", "km": total_km}
    overall.update({t: coverage(edges, t) for t in tags})
    rows.append(overall)
    for hw, g in edges.groupby("hw"):
        row = {"hw": hw, "km": g["length_m"].sum() / 1000}
        row.update({t: coverage(g, t) for t in tags})
        rows.append(row)

    out = pd.DataFrame(rows).sort_values("km", ascending=False)
    out.to_csv(DATA / "audit_physical.csv", index=False)

    show = out.copy()
    for t in tags:
        show[t] = (show[t] * 100).round(1).astype(str) + "%"
    show["km"] = show["km"].round(1)
    print("Share of length with the tag present (by highway class):")
    print(show.to_string(index=False))

    steps = edges[edges["hw"] == "steps"]
    print(f"\nSteps: {len(steps):,} edges, {steps['length_m'].sum() / 1000:.1f} km")

    nodes_path = DATA / "nodes.parquet"
    if nodes_path.exists():
        nodes = pd.read_parquet(nodes_path)
        if "crossing" in nodes.columns:
            crossings = nodes[has_value(nodes["crossing"])]
            kerb_known = crossings["kerb"].pipe(has_value).sum() if "kerb" in crossings.columns else 0
            print(
                f"Crossing nodes: {len(crossings):,}; with a kerb tag: {kerb_known:,} "
                f"({(kerb_known / len(crossings) * 100) if len(crossings) else 0:.1f}%)"
            )

    print(f"\nSaved {DATA / 'audit_physical.csv'}")
    print("Note: a missing tag means UNKNOWN, not 'good'. Low coverage means a physical profile would be mostly unknowns.")


if __name__ == "__main__":
    main()
