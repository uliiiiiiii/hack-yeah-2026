"""Tests for the quiet-places endpoints (declared data, votes, check-ins, calm).

Reuse the ``client`` fixture from ``tests/conftest.py``: it writes a synthetic
graph, points DATA_DIR at a tmp_path, and reloads the app — so the SQLite store
is empty and isolated per test, and the Kraków bbox check passes.
"""


def _payload(**overrides):
    body = {
        "name": "Cafe Miła",
        "type": "Cafe",
        "lat": 50.0600,
        "lon": 19.9400,
        "entry_condition": "open_to_anyone",
        "quiet_hours": [{"day": 0, "start": "09:00", "end": "17:00"}],
        "device_id": "dev-test",
    }
    body.update(overrides)
    return body


def _create(client, **overrides):
    r = client.post("/quiet-places", json=_payload(**overrides))
    assert r.status_code == 200, r.text
    return r.json()


def test_create_and_list_round_trip(client):
    p = _create(client)
    assert p["id"] == 1
    assert p["trust"] == "reported"
    assert p["verified"] is False

    r = client.get("/quiet-places")
    assert r.status_code == 200
    assert [x["name"] for x in r.json()["places"]] == ["Cafe Miła"]


def test_create_rejects_missing_name(client):
    r = client.post("/quiet-places", json=_payload(name="   "))
    assert r.status_code == 400
    assert r.json()["error"] == "bad_request"


def test_create_rejects_bad_schedule(client):
    r = client.post("/quiet-places", json=_payload(
        quiet_hours=[{"day": 0, "start": "17:00", "end": "09:00"}],
    ))
    assert r.status_code == 400
    assert r.json()["error"] == "bad_request"


def test_create_rejects_bad_entry_condition(client):
    r = client.post("/quiet-places", json=_payload(entry_condition="members_only"))
    assert r.status_code == 400
    assert r.json()["error"] == "bad_request"


def test_create_rejects_point_outside_krakow_bbox(client):
    # The synthetic graph's bbox is a small box around 50.06/19.94; Madrid is out.
    r = client.post("/quiet-places", json=_payload(lat=40.4, lon=-3.7))
    assert r.status_code == 422
    assert r.json()["error"] == "out_of_area"


def test_vote_upserts_per_device(client):
    _create(client)
    for _ in range(2):
        r = client.post("/quiet-places/1/vote", json={"device_id": "dev-a", "value": "not_accurate"})
        assert r.status_code == 200
    assert r.json()["vote_counts"] == {"accurate": 0, "not_accurate": 1}


def test_vote_rejects_bad_value(client):
    _create(client)
    r = client.post("/quiet-places/1/vote", json={"device_id": "dev-a", "value": "maybe"})
    assert r.status_code == 400


def test_vote_unknown_place_404(client):
    r = client.post("/quiet-places/999/vote", json={"device_id": "dev-a", "value": "accurate"})
    assert r.status_code == 404


def test_checkin_records_presence(client):
    _create(client)
    r = client.post("/quiet-places/1/checkin", json={"device_id": "dev-a", "value": "yes"})
    assert r.status_code == 200
    assert r.json()["checkin_counts"]["total"] == 1


def test_calm_places_filters_by_time_and_dispute(client):
    _create(client)  # quiet hours Mon 09:00-17:00
    r = client.get("/calm-places", params={"lat": 50.0600, "lon": 19.9400, "day": 0, "hour": 12})
    assert r.status_code == 200
    assert [p["name"] for p in r.json()["places"]] == ["Cafe Miła"]

    # Tuesday is outside its only window.
    r = client.get("/calm-places", params={"lat": 50.0600, "lon": 19.9400, "day": 1, "hour": 12})
    assert r.json()["places"] == []

    # Three "not accurate" votes -> disputed -> excluded even at an active time.
    for d in ("a", "b", "c"):
        client.post("/quiet-places/1/vote", json={"device_id": d, "value": "not_accurate"})
    r = client.get("/calm-places", params={"lat": 50.0600, "lon": 19.9400, "day": 0, "hour": 12})
    assert r.json()["places"] == []


def test_verify_disabled_without_token(client):
    _create(client)
    r = client.post("/quiet-places/1/verify", json={"token": "x", "verified": True})
    assert r.status_code == 401


def test_verify_with_token(client, monkeypatch):
    monkeypatch.setenv("VERIFY_TOKEN", "secret")
    _create(client)
    r = client.post("/quiet-places/1/verify", json={"token": "secret", "verified": True, "note": "checked"})
    assert r.status_code == 200
    assert r.json()["verified"] is True
    assert r.json()["verified_note"] == "checked"

    r = client.post("/quiet-places/1/verify", json={"token": "wrong", "verified": True})
    assert r.status_code == 401
