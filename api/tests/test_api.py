"""HTTP-level tests via FastAPI TestClient against the synthetic graph."""


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["node_count"] == 6
    assert body["edge_count"] == 12  # 6 base edges x 2 directions
    assert "shortest" in body["profiles"]


def test_route_success(client):
    r = client.get("/route", params={"from": "50.0600,19.9400", "to": "50.0600,19.9460"})
    assert r.status_code == 200
    feat = r.json()
    assert feat["type"] == "Feature"
    assert feat["geometry"]["type"] == "LineString"
    props = feat["properties"]
    assert props["profile"] == "shortest"
    assert props["length_m"] == 650.0
    assert props["edge_count"] == 2
    assert "km" in props["summary"]
    assert props["data_built_at"] == "2026-01-01T00:00:00Z"


def test_bad_request_missing_param(client):
    r = client.get("/route", params={"from": "50.06,19.94"})
    assert r.status_code == 400
    assert r.json()["error"] == "bad_request"


def test_bad_request_unknown_profile(client):
    r = client.get("/route", params={
        "from": "50.0600,19.9400", "to": "50.0600,19.9460", "profile": "nope",
    })
    assert r.status_code == 400
    assert r.json()["error"] == "bad_request"


def test_out_of_area(client):
    # Far from any synthetic node but inside lat/lon sanity; triggers out_of_area.
    r = client.get("/route", params={"from": "50.0600,19.9400", "to": "51.5000,19.9400"})
    assert r.status_code == 422
    assert r.json()["error"] == "out_of_area"


def test_no_route(client):
    # Node 4/5 component vs node 0 component -> no_route. Point near node 4.
    r = client.get("/route", params={"from": "50.0600,19.9400", "to": "50.0600,19.9600"})
    assert r.status_code == 404
    assert r.json()["error"] == "no_route"
