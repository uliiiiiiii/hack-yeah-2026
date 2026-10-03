"""Routing-core tests on the synthetic graph (see conftest.write_synthetic_data)."""
import numpy as np
import pandas as pd

import profiles


def test_parallel_edges_reduced_to_cheapest(graph):
    """The 0->1 pair has two parallel edges (400 m and 300 m); CSR must keep 300."""
    pm = graph._profile_matrix("shortest")
    # csr_matrix sums duplicates; if dedup failed this would be 700, not 300.
    assert pm.matrix[0, 1] == 300.0
    # And the kept edge is the 300 m one.
    edge_idx = pm.edge_of_pair[(0, 1)]
    assert graph.edge_length[edge_idx] == 300.0


def test_route_path_and_length(graph):
    """0 -> 3 should go 0->1->3 (300+350=650), not 0->2->3 (350+500=850)."""
    result = graph.route(0, 3, "shortest")
    assert result is not None
    assert result["edge_count"] == 2
    assert result["length_m"] == 650.0
    # Geometry starts at node 0 and ends at node 3, in [lon, lat] order.
    first = result["coordinates"][0]
    last = result["coordinates"][-1]
    assert first == [19.9400, 50.0600] or tuple(first) == (19.9400, 50.0600)
    assert last == [19.9460, 50.0600] or tuple(last) == (19.9460, 50.0600)


def test_no_route_between_components(graph):
    """Nodes {4,5} form a separate component; 0 -> 4 has no path."""
    assert graph.route(0, 4, "shortest") is None


def test_inf_cost_removes_edge(graph, monkeypatch):
    """A profile returning inf for the 0<->1 edges forces the 0->2->3 detour."""
    def block_0_1(edges: pd.DataFrame) -> np.ndarray:
        mult = np.ones(len(edges), dtype="float64")
        mask = (
            ((edges["u_idx"] == 0) & (edges["v_idx"] == 1))
            | ((edges["u_idx"] == 1) & (edges["v_idx"] == 0))
        ).to_numpy()
        mult[mask] = np.inf
        return mult

    monkeypatch.setitem(profiles.PROFILES, "block", block_0_1)
    result = graph.route(0, 3, "block")
    assert result is not None
    # Forced detour 0->2->3 = 350 + 500 = 850.
    assert result["length_m"] == 850.0
    assert result["edge_count"] == 2


def test_nearest_node_and_rejection(graph):
    """Nearest-node snapping is close for an on-graph point, far for a distant one."""
    idx, dist = graph.nearest_node(50.0600, 19.9400)
    assert idx == 0
    assert dist < 5.0
    # A point ~ far away (still within lat/lon sanity) must snap > 500 m.
    _, far = graph.nearest_node(50.1000, 20.0000)
    assert far > 500.0
