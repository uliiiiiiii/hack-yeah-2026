"""Routing profiles: turn edge attributes into a per-edge cost multiplier.

Routed cost of an edge is ``length_m * multiplier``. Multipliers are >= 1.0
(a profile may make an edge worse, never shorter); ``np.inf`` excludes an edge.

Two things live here:

1. ``PROFILES`` — a registry of simple named profiles (``shortest``). Each is a
   function ``f(edges) -> np.ndarray`` of multipliers.

2. ``sensory_cost`` — the parameterized "pick the issues that affect you" router.
   The user selects factors (noise, light); we combine the selected factors into
   one multiplier AND report, per factor, where the underlying data is unknown.

Data principle: a missing tag/measurement is UNKNOWN, never "good". Unknown edges
contribute 0 penalty (neutral) but are reported as unknown so the UI can flag the
route segments we can't vouch for. Adding a new factor later (e.g. crowds) is just
another ``_factor_*`` helper + a branch in ``sensory_cost`` — no plumbing changes.
"""
from typing import Callable

import numpy as np
import pandas as pd

# How strongly selected factors bend the route. Applied to each factor's 0..1
# "badness"; multiplier = 1 + weight * sum(badness of active factors).
STRENGTH_WEIGHT = {"low": 2.0, "medium": 4.0, "high": 8.0}

# Lden dB mapped to 0..1 badness: 50 dB (quiet) -> 0, 85 dB (very loud) -> 1.
NOISE_DB_QUIET = 50.0
NOISE_DB_LOUD = 85.0

LIGHT_MODES = ("avoid_bright", "prefer_lit")


def shortest(edges: pd.DataFrame) -> np.ndarray:
    """Plain shortest path: every edge costs exactly its length (multiplier 1.0)."""
    return np.ones(len(edges), dtype="float64")


PROFILES: dict[str, Callable[[pd.DataFrame], np.ndarray]] = {
    "shortest": shortest,
}


def _factor_noise(edges: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    """Return (badness 0..1, known) for road-traffic noise (Lden)."""
    n = len(edges)
    if "noise_lden_db" not in edges.columns:
        return np.zeros(n), np.zeros(n, dtype=bool)
    db = pd.to_numeric(edges["noise_lden_db"], errors="coerce").to_numpy(dtype="float64")
    known = np.isfinite(db)
    bad = np.clip((db - NOISE_DB_QUIET) / (NOISE_DB_LOUD - NOISE_DB_QUIET), 0.0, 1.0)
    bad = np.where(known, bad, 0.0)  # unknown -> neutral, not quiet
    return bad, known


def _lit_state(edges: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    """Return (is_lit, is_unlit) boolean arrays from the OSM 'lit' tag.

    Known lighting = lit or unlit; anything else (missing, odd values) is unknown.
    """
    n = len(edges)
    if "lit" not in edges.columns:
        return np.zeros(n, dtype=bool), np.zeros(n, dtype=bool)
    first = edges["lit"].astype("string").str.split(";").str[0].str.strip().str.lower()
    lit_vals = {"yes", "24/7", "automatic", "limited", "dusk-dawn"}
    is_lit = first.isin(lit_vals).fillna(False).to_numpy()
    is_unlit = (first == "no").fillna(False).to_numpy()
    return is_lit, is_unlit


def _factor_light(edges: pd.DataFrame, mode: str) -> tuple[np.ndarray, np.ndarray]:
    """Return (badness 0..1, known) for a light mode.

    - avoid_bright: penalize lit streets (brighter at night).
    - prefer_lit:   penalize unlit streets (darker; e.g. night-safety routing).
    Known = we know whether the street is lit or unlit.
    """
    is_lit, is_unlit = _lit_state(edges)
    known = is_lit | is_unlit
    if mode == "avoid_bright":
        bad = is_lit.astype("float64")
    else:  # prefer_lit
        bad = is_unlit.astype("float64")
    return bad, known


def sensory_cost(
    edges: pd.DataFrame,
    *,
    noise: bool = False,
    light: str | None = None,
    strength: str = "medium",
) -> tuple[np.ndarray, dict[str, np.ndarray]]:
    """Combine the selected factors into a per-edge multiplier.

    Returns ``(multiplier, factor_known)`` where ``factor_known`` maps each active
    factor name to a boolean array (True where that factor's data is known for the
    edge). The caller uses ``factor_known`` to report/flag uncertain route parts.
    """
    weight = STRENGTH_WEIGHT.get(strength, STRENGTH_WEIGHT["medium"])
    badness = np.zeros(len(edges), dtype="float64")
    factor_known: dict[str, np.ndarray] = {}

    if noise:
        bad, known = _factor_noise(edges)
        badness = badness + bad
        factor_known["noise"] = known

    if light in LIGHT_MODES:
        bad, known = _factor_light(edges, light)
        badness = badness + bad
        factor_known["light"] = known

    multiplier = 1.0 + weight * badness
    return multiplier, factor_known
