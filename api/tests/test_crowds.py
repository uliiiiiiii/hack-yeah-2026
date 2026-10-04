"""Crowd-factor tests. The BestTime HTTP calls aren't exercised here (they need a
key); we test the layer math and the wiring with synthetic venues."""
import numpy as np

import crowds
from profiles import sensory_cost


def _node_xy(graph, idx):
    return graph.node_lat[idx], graph.node_lon[idx]


def test_build_crowd_layer_penalty_and_coverage(graph):
    # Put a busy venue exactly at the midpoint of edge 1->3 (edge_idx 6).
    la1, lo1 = _node_xy(graph, 1)
    la3, lo3 = _node_xy(graph, 3)
    venue = {"lat": (la1 + la3) / 2, "lon": (lo1 + lo3) / 2, "busyness": 1.0}
    penalty, known = crowds.build_crowd_layer(graph, [venue])

    # The edge whose midpoint coincides with the venue is maximally busy & known.
    assert penalty[6] > 0.9
    assert known[6]
    # The disconnected {4,5} component is ~1 km away: no data there.
    far_edges = [i for i, (u, v) in enumerate(zip(graph.u_idx, graph.v_idx))
                 if u in (4, 5) and v in (4, 5)]
    assert all(penalty[i] == 0.0 for i in far_edges)
    assert all(not known[i] for i in far_edges)


def test_empty_venues_all_unknown(graph):
    penalty, known = crowds.build_crowd_layer(graph, [])
    assert not penalty.any()
    assert not known.any()


def test_sensory_crowd_penalizes_busy_edges(graph):
    la1, lo1 = _node_xy(graph, 1)
    la3, lo3 = _node_xy(graph, 3)
    penalty, known = crowds.build_crowd_layer(
        graph, [{"lat": (la1 + la3) / 2, "lon": (lo1 + lo3) / 2, "busyness": 1.0}]
    )
    graph.edges["crowd_penalty"] = penalty
    graph.edges["crowd_known"] = known

    mult, fk = sensory_cost(graph.edges, crowd=True, strength="high")
    assert "crowd" in fk
    # The busy edge costs more than a neutral one.
    assert mult[6] > 1.0
    assert mult[6] > mult[10]  # edge 10 is in the far {4,5} component (no crowd)


def test_api_crowd_requires_key(client, monkeypatch):
    # With no BestTime key the crowd factor is unavailable → 400. Force the key
    # absent so this holds regardless of any real key in the developer's .env.
    monkeypatch.setattr(crowds, "api_key", lambda: None)
    r = client.get("/route", params={
        "from": "50.0600,19.9400", "to": "50.0600,19.9460",
        "profile": "sensory", "crowd": "on",
    })
    assert r.status_code == 400
    assert r.json()["error"] == "bad_request"
