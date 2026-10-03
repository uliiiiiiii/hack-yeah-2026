"""Routing profiles: functions from edge attributes to a per-edge cost multiplier.

A profile is a pure function ``f(edges: pd.DataFrame) -> np.ndarray`` returning one
float per edge. The routed cost of an edge is ``length_m * multiplier``.

Contract for every profile:
  * return a float array aligned 1:1 with the rows of ``edges``;
  * every multiplier must be >= 1.0 (a profile may make an edge worse, never shorter
    than its true length);
  * return ``np.inf`` for an edge to exclude it entirely (a hard barrier).

How to add a profile
--------------------
1. Write a function that reads only columns from the edges DataFrame. Remember the
   data principle: a missing tag is UNKNOWN, not "good". Do not coerce nulls into
   favourable values — decide explicitly what an unknown means for your profile.
2. Register it in the ``PROFILES`` dict below under a short lowercase key.
3. The API will expose it automatically via ``?profile=<key>``. No other plumbing
   needs to change — the edge table stays the single source of truth.

Example (illustrative only; not registered)::

    def avoid_steps(edges):
        mult = np.ones(len(edges), dtype="float64")
        is_steps = edges["highway"].astype("string").str.split(";").str[0] == "steps"
        mult[is_steps.fillna(False).to_numpy()] = np.inf  # exclude all stairs
        return mult
"""
from typing import Callable

import numpy as np
import pandas as pd


def shortest(edges: pd.DataFrame) -> np.ndarray:
    """Plain shortest path: every edge costs exactly its length (multiplier 1.0)."""
    return np.ones(len(edges), dtype="float64")


PROFILES: dict[str, Callable[[pd.DataFrame], np.ndarray]] = {
    "shortest": shortest,
}
