"""Attach Kraków's real 2022 road-traffic noise map to the walking network.

Source: City of Kraków MSIP strategic acoustic map 2022, road-noise *immission*
layer in LDWN (= Lden, day-evening-night), as downloadable SHP. We sample the
noise band (dB) at each edge's midpoint and write a per-edge overlay.

    data/edge_sensory.parquet : edge_idx, noise_lden_db, noise_band, noise_known

Run from etl/ (after build_edges.py):
    python build_noise.py            # uses cached download if present
    python build_noise.py --force    # re-download

Honesty notes:
- This is ROAD-traffic noise immission only (the dominant urban source for
  pedestrians). Rail/industry/air layers exist in the same dataset and could be
  added later the same way.
- The map classifies the whole agglomeration, including an explicit "<55 dB"
  quiet band, so coverage is ~100% inside Kraków. Edges whose midpoint falls
  outside every mapped band get noise_known=False and a null dB (never assumed
  quiet) -- keeping with "missing data is not good data".
"""
import argparse
import struct
import sys
import zlib
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely import line_interpolate_point

DATA = Path(__file__).resolve().parent.parent / "data"
RAW = DATA / "raw_noise"
ZIP_URL = "https://msip.um.krakow.pl/Dane/Mapa_Halasu_2022_SHP.zip"
ZIP_PATH = RAW / "Mapa_Halasu_2022_SHP.partial.zip"
LAYER = "halas_2022_imisja_dr_LDWN"  # road immission LDWN (Lden)
SHP = RAW / f"{LAYER}.shp"
# We only need the bytes up to the end of this layer's .shx (~90.8 MB).
ENOUGH_BYTES = 92_000_000


def download_zip() -> None:
    """Stream the city ZIP until we have enough bytes for the LDWN layer.

    The city server is slow and often drops the connection partway, but the
    layer we need sits in the first ~91 MB, so a partial download is fine. We
    resume across attempts.
    """
    import requests

    RAW.mkdir(parents=True, exist_ok=True)
    for attempt in range(1, 9):
        have = ZIP_PATH.stat().st_size if ZIP_PATH.exists() else 0
        if have >= ENOUGH_BYTES:
            return
        headers = {"Range": f"bytes={have}-"} if have else {}
        print(f"  download attempt {attempt}: have {have:,} bytes, requesting more…")
        try:
            with requests.get(ZIP_URL, headers=headers, stream=True, timeout=(30, 60)) as r:
                mode = "ab" if (have and r.status_code == 206) else "wb"
                if mode == "wb":
                    have = 0
                with open(ZIP_PATH, mode) as f:
                    for chunk in r.iter_content(1 << 20):
                        if not chunk:
                            break
                        f.write(chunk)
                        have += len(chunk)
                        if have >= ENOUGH_BYTES:
                            print(f"  got {have:,} bytes (enough).")
                            return
        except Exception as exc:
            print(f"  attempt {attempt} interrupted: {exc}")
    have = ZIP_PATH.stat().st_size if ZIP_PATH.exists() else 0
    if have < ENOUGH_BYTES:
        raise RuntimeError(
            f"Could only fetch {have:,} bytes of {ZIP_URL} (need ~{ENOUGH_BYTES:,}). "
            "The city server is unreliable; re-run to resume."
        )


def extract_layer() -> None:
    """Extract the LDWN shapefile components from the (possibly partial) ZIP.

    Reads local file headers directly so a truncated ZIP (no central directory)
    still works, as long as the target members are fully present.
    """
    data = ZIP_PATH.read_bytes()
    n = len(data)
    sig = b"PK\x03\x04"
    offs = []
    i = 0
    while True:
        j = data.find(sig, i)
        if j < 0:
            break
        offs.append(j)
        i = j + 4
    hdrs = []
    for j in offs:
        _, _, method, _, _, _, _, _, nlen, elen = struct.unpack("<HHHHHIIIHH", data[j + 4:j + 30])
        name = data[j + 30:j + 30 + nlen].decode("utf-8", "replace")
        hdrs.append((j, name, method, j + 30 + nlen + elen))

    RAW.mkdir(parents=True, exist_ok=True)
    wanted_prefix = f"{LAYER}."  # trailing dot excludes the _izofony layer
    written = []
    for k, (j, name, method, doff) in enumerate(hdrs):
        base = name.rsplit("/", 1)[-1]
        if not base.startswith(wanted_prefix):
            continue
        if base.endswith((".sbn", ".sbx", ".shp.xml")):
            continue  # spatial index / metadata not needed
        end = hdrs[k + 1][0] if k + 1 < len(hdrs) else n
        raw = data[doff:end]
        if method == 8:
            d = zlib.decompressobj(-15)
            out = d.decompress(raw) + d.flush()
        else:
            out = raw
        (RAW / base).write_bytes(out)
        written.append(base)
    if f"{LAYER}.shp" not in written:
        raise RuntimeError("Could not extract the LDWN .shp from the ZIP (truncated too early?).")
    print(f"  extracted: {', '.join(sorted(written))}")


def band_db(isov1: float, isov2: float) -> float:
    """Representative Lden (dB) for a noise band polygon [isov1, isov2]."""
    if isov1 >= 80:  # the 80+ band is stored as 80..80
        return 82.5
    lo = max(isov1, 50.0)  # the lowest '<55' band has a nonsense lower bound
    return (lo + isov2) / 2.0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="re-download and re-extract")
    args = ap.parse_args()

    edges_path = DATA / "edges.parquet"
    if not edges_path.exists():
        print(f"ERROR: {edges_path} not found. Run build_edges.py first.", file=sys.stderr)
        return 1

    if args.force:
        for p in RAW.glob(f"{LAYER}.*"):
            p.unlink()

    if not SHP.exists():
        if not (ZIP_PATH.exists() and ZIP_PATH.stat().st_size >= ENOUGH_BYTES):
            print("Downloading Kraków 2022 noise map (city server is slow; resumes on re-run)…")
            download_zip()
        print("Extracting the LDWN road-immission layer…")
        extract_layer()

    print("Loading noise polygons…")
    noise = gpd.read_file(SHP).to_crs(4326)
    noise["noise_db"] = [band_db(a, b) for a, b in zip(noise["isov1"], noise["isov2"])]

    print("Sampling noise at edge midpoints…")
    edges = gpd.read_parquet(edges_path)
    mids = line_interpolate_point(edges.geometry.values, 0.5, normalized=True)
    pts = gpd.GeoDataFrame(
        {"edge_idx": edges["edge_idx"].to_numpy()}, geometry=mids, crs=4326
    )
    joined = gpd.sjoin(pts, noise[["noise_db", "geometry"]], how="left", predicate="within")
    # A midpoint can fall in overlapping bands; keep the loudest (max dB).
    joined = joined.sort_values("noise_db").drop_duplicates("edge_idx", keep="last")
    joined = joined.set_index("edge_idx").reindex(edges["edge_idx"].to_numpy())

    out = pd.DataFrame({
        "edge_idx": edges["edge_idx"].to_numpy(),
        "noise_lden_db": joined["noise_db"].to_numpy(dtype="float64"),
    })
    out["noise_known"] = out["noise_lden_db"].notna()
    # 0..1 noise penalty (50 dB -> 0, 85 dB -> 1); null where unknown. Used by the
    # sensory profile and by audit_tradeoff.py (--penalty-col noise_penalty).
    out["noise_penalty"] = ((out["noise_lden_db"] - 50.0) / 35.0).clip(0.0, 1.0)
    # band label for display, null where unknown
    def band_label(db):
        if pd.isna(db):
            return pd.NA
        if db < 55:
            return "<55"
        if db >= 80:
            return "80+"
        lo = int(db // 5 * 5)
        return f"{lo}-{lo + 5}"
    out["noise_band"] = out["noise_lden_db"].map(band_label).astype("string")

    out.to_parquet(DATA / "edge_sensory.parquet", index=False)

    tot = edges["length_m"].to_numpy()
    known = out["noise_known"].to_numpy()
    cov = tot[known].sum() / tot.sum() * 100
    print(f"\nedge_sensory.parquet: {len(out):,} edges")
    print(f"noise known: {known.mean() * 100:.1f}% by count, {cov:.1f}% by length")
    print("Done. The API will merge this overlay onto edges at load time.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
