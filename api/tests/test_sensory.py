"""Tests for the multi-factor sensory routing (noise + bidirectional light)."""
from profiles import sensory_cost


def test_health_reports_factors(client):
    body = client.get("/health").json()
    assert "sensory" in body["profiles"]
    assert body["factors"]["noise"] is True   # synthetic overlay present
    assert body["factors"]["light"] is True   # 'lit' column exists (all unknown)


def test_noise_avoidance_reroutes(graph):
    """0->1 edges are loud (80 dB); avoiding noise should take the quiet detour."""
    mult, known = sensory_cost(graph.edges, noise=True, strength="high")
    r = graph.route(0, 3, multiplier=mult, cache_key="t-noise-high")
    assert r is not None
    # Detour 0->2->3 = 350 + 500 = 850, instead of the loud 0->1->3 = 650.
    assert r["length_m"] == 850.0
    # And plain shortest still takes the short loud way.
    s = graph.route(0, 3, "shortest")
    assert s["length_m"] == 650.0


def test_api_noise_route_has_exposure(client):
    r = client.get("/route", params={
        "from": "50.0600,19.9400", "to": "50.0600,19.9460",
        "profile": "sensory", "noise": "on", "strength": "high",
    })
    assert r.status_code == 200
    props = r.json()["properties"]
    assert props["profile"] == "sensory"
    assert props["factors"]["noise"] is True
    assert props["length_m"] == 850.0            # avoided the loud edge
    assert "noise" in props["exposure"]
    assert props["exposure"]["noise"]["loud_pct"] == 0.0   # detour is quiet
    assert props["uncertainty"]["noise"]["unknown_pct"] == 0.0  # noise fully known


def test_api_light_uncertainty_flagged(client):
    """Lighting is all-unknown in the fixture → 100% flagged, route unchanged."""
    r = client.get("/route", params={
        "from": "50.0600,19.9400", "to": "50.0600,19.9460",
        "profile": "sensory", "light": "prefer_lit",
    })
    assert r.status_code == 200
    body = r.json()
    props = body["properties"]
    assert props["uncertainty"]["light"]["unknown_pct"] == 100.0
    # Whole route is uncertain → at least one uncertain segment spanning it.
    assert len(body["uncertain_segments"]) >= 1
    assert sum(len(s) for s in body["uncertain_segments"]) >= 2


def test_api_bad_light_mode(client):
    r = client.get("/route", params={
        "from": "50.0600,19.9400", "to": "50.0600,19.9460",
        "profile": "sensory", "light": "nope",
    })
    assert r.status_code == 400
    assert r.json()["error"] == "bad_request"


def test_api_unknown_profile(client):
    r = client.get("/route", params={
        "from": "50.0600,19.9400", "to": "50.0600,19.9460", "profile": "bogus",
    })
    assert r.status_code == 400
    assert r.json()["error"] == "bad_request"
