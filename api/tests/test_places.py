"""Tests for place-name search (INP-01) and the /places proxy endpoint.

No test touches the network: ``places._fetch`` is stubbed. The throttle is
neutralised too, so the rate limiter is verified separately by its own unit test
rather than by making the suite sleep.
"""
import pytest

import places

import time


@pytest.fixture(autouse=True)
def clean_cache(monkeypatch):
    """Give every test a fresh cache, and neutralise the throttle on the shared one.

    Only the shared instance is stubbed: limiters built *inside* a test must keep
    the real rate-limit behaviour, which is what the limiter tests assert.
    """
    monkeypatch.setattr(places, "CACHE", places._Cache(ttl_s=3600))
    monkeypatch.setattr(places.CACHE, "reserve_slot", lambda: 0.0)
    yield


def stub_fetch(monkeypatch, rows_by_query):
    """Replace the upstream call; records the queries it was asked for."""
    calls: list[str] = []

    def fake_fetch(query, lang, limit):
        calls.append(query)
        for needle, rows in rows_by_query.items():
            if needle in query.lower():
                return rows
        return []

    monkeypatch.setattr(places, "_fetch", fake_fetch)
    return calls


# ---- diacritic folding (INP-01: "Lagiewniki" finds "Łagiewniki") ----

@pytest.mark.parametrize("text,expected", [
    ("Łagiewniki", "lagiewniki"),
    ("Lagiewniki", "lagiewniki"),
    ("Płaszów", "plaszow"),
    ("Żywiec", "zywiec"),
    ("ŻÓŁĆ", "zolc"),
    ("  Wawel   Castle ", "wawel castle"),
])
def test_fold_strips_diacritics_and_case(text, expected):
    assert places.fold(text) == expected


def test_fold_is_idempotent():
    assert places.fold(places.fold("Łagiewniki")) == "lagiewniki"


# ---- shaping upstream rows ----

def test_shape_uses_name_as_label_and_rest_as_detail():
    place, is_address = places._shape({
        "name": "Wawel",
        "display_name": "Wawel, Stare Miasto, Krakow, Lesser Poland Voivodeship, Poland",
        "lat": "50.0547", "lon": "19.9361",
    })
    assert place == {
        "label": "Wawel",
        "detail": "Stare Miasto, Krakow, Lesser Poland Voivodeship",
        "lat": pytest.approx(50.0547),
        "lon": pytest.approx(19.9361),
    }
    assert is_address is False


def test_shape_composes_street_and_house_number_for_an_address():
    """A house address has an EMPTY name; the label must still read "Sienna 5",
    not a bare "5" (the bug that made address search look broken)."""
    place, is_address = places._shape({
        "name": "",
        "type": "house",
        "display_name": "5, Sienna, Old Town, Stare Miasto, Krakow, Poland",
        "address": {"road": "Sienna", "house_number": "5",
                    "suburb": "Stare Miasto", "city": "Krakow"},
        "lat": "50.06", "lon": "19.93",
    })
    assert place["label"] == "Sienna 5"
    assert place["detail"] == "Stare Miasto, Krakow"
    assert is_address is True


def test_shape_composes_address_from_display_name_when_structured_data_is_missing():
    place, _ = places._shape({
        "name": "", "type": "house",
        "display_name": "12, Wawelska, Krakow, Poland",
        "lat": "50.06", "lon": "19.93",
    })
    assert place["label"] == "Wawelska 12"


def test_shape_falls_back_to_first_display_part_when_name_missing():
    out, _ = places._shape({"display_name": "Rynek 1, Krakow, Poland", "lat": "50.06", "lon": "19.93"})
    assert out["label"] == "Rynek 1"


@pytest.mark.parametrize("row", [
    {"name": "X", "lat": "abc", "lon": "19.9"},
    {"name": "X", "lat": "50.0"},                       # no lon
    {"name": "", "display_name": "", "lat": "50", "lon": "19"},  # no label
    {"name": "X", "lat": "999", "lon": "19.9"},         # out of range
])
def test_shape_rejects_unusable_rows(row):
    assert places._shape(row) is None


# ---- Polish street prefixes ("ul. Sienna 5") ----

@pytest.mark.parametrize("raw,expected", [
    ("ul. Sienna 5", "Sienna 5"),
    ("ulica Sienna 5", "Sienna 5"),
    ("al. Focha 12", "Focha 12"),
    ("aleja Focha 12", "Focha 12"),
    ("pl. Matejki 3", "Matejki 3"),
    ("os. Ogrodowa 1", "Ogrodowa 1"),
    ("Sienna 5", "Sienna 5"),          # already clean
    ("Wawel", "Wawel"),                # not a prefix
])
def test_strip_street_prefix(raw, expected):
    assert places.strip_street_prefix(raw) == expected


def test_strip_street_prefix_keeps_query_if_stripping_empties_it():
    assert places.strip_street_prefix("ul.") == "ul."


@pytest.mark.parametrize("q,expected", [
    ("Sienna 5", True),
    ("Sienna 5a", True),
    ("Sienna", False),
    ("Wawel", False),
])
def test_looks_like_address(q, expected):
    assert places.looks_like_address(q) is expected


def test_address_query_ranks_the_house_above_a_venue(monkeypatch):
    """Without this, "Krakowska 1" returned a club first and the house never showed."""
    stub_fetch(monkeypatch, {"krakowska": [
        {"name": "Gemini", "type": "nightclub", "lat": "50.06", "lon": "19.94",
         "address": {"road": "Krakowska", "house_number": "1", "city": "Krakow"}},
        {"name": "", "type": "house", "lat": "50.061", "lon": "19.941",
         "address": {"road": "Krakowska", "house_number": "1", "city": "Krakow"}},
    ]})
    out = places.search("Krakowska 1")
    assert out[0]["label"] == "Krakowska 1"
    assert out[1]["label"] == "Gemini"


def test_search_strips_the_polish_prefix_before_calling_upstream(monkeypatch):
    calls = stub_fetch(monkeypatch, {"sienna": [
        {"name": "", "type": "house", "lat": "50.06", "lon": "19.93",
         "address": {"road": "Sienna", "house_number": "5", "city": "Krakow"}},
    ]})
    out = places.search("ul. Sienna 5")
    assert calls == ["Sienna 5"]
    assert out[0]["label"] == "Sienna 5"


# ---- search: caching, fallback, validation ----

def test_search_returns_shaped_results(monkeypatch):
    stub_fetch(monkeypatch, {"wawel": [
        {"name": "Wawel", "display_name": "Wawel, Krakow, Poland", "lat": "50.05", "lon": "19.93"},
    ]})
    out = places.search("Wawel")
    assert len(out) == 1 and out[0]["label"] == "Wawel"


def test_search_caches_so_repeat_queries_do_not_re_hit_upstream(monkeypatch):
    calls = stub_fetch(monkeypatch, {"wawel": [
        {"name": "Wawel", "display_name": "Wawel, Krakow, Poland", "lat": "50.05", "lon": "19.93"},
    ]})
    places.search("Wawel")
    places.search("wawel")     # same query, different case
    assert len(calls) == 1


def test_short_queries_short_circuit_without_calling_upstream(monkeypatch):
    calls = stub_fetch(monkeypatch, {"wawel": []})
    assert places.search("W") == []
    assert calls == []


def test_search_propagates_geocoder_failure(monkeypatch):
    def boom(query, lang, limit):
        raise places.GeocodeError("Could not reach the place search service.")

    monkeypatch.setattr(places, "_fetch", boom)
    with pytest.raises(places.GeocodeError):
        places.search("Wawel")


# ---- rate limiter (the policy's 1 req/s cap) ----

def test_rate_limiter_spaces_calls_at_least_min_interval_apart():
    limiter = places._Cache()
    assert limiter.reserve_slot() == 0.0            # first call goes immediately
    second = limiter.reserve_slot()
    assert second == pytest.approx(places.MIN_INTERVAL_S, abs=0.01)
    third = limiter.reserve_slot()
    assert third == pytest.approx(2 * places.MIN_INTERVAL_S, abs=0.01)


def test_rate_limiter_releases_a_slot_once_the_wait_has_passed():
    limiter = places._Cache()
    limiter.reserve_slot()                          # consume the current slot
    time.sleep(places.MIN_INTERVAL_S + 0.05)
    # Time has moved on, so the next call is not delayed again.
    assert limiter.reserve_slot() == pytest.approx(0.0, abs=0.01)


# ---- endpoint ----

def test_places_endpoint_returns_results(client, monkeypatch):
    monkeypatch.setattr(places, "search", lambda q, **kw: [
        {"label": "Wawel", "detail": "Krakow", "lat": 50.05, "lon": 19.93},
    ])
    r = client.get("/places", params={"q": "Wawel"})
    assert r.status_code == 200
    body = r.json()
    assert body["query"] == "Wawel"
    assert body["results"][0]["label"] == "Wawel"
    assert "OpenStreetMap" in body["attribution"]   # ODbL attribution must travel


def test_places_endpoint_rejects_too_short_query(client):
    r = client.get("/places", params={"q": "W"})
    assert r.status_code == 400
    assert r.json()["error"] == "bad_request"


def test_places_endpoint_reports_upstream_failure_honestly(client, monkeypatch):
    def boom(q, **kw):
        raise places.GeocodeError("Place search is busy. Try again in a moment.")

    monkeypatch.setattr(places, "search", boom)
    r = client.get("/places", params={"q": "Wawel"})
    assert r.status_code == 502
    body = r.json()
    # Must not be dressed up as "no results" (UNC-01 honesty principle).
    assert body["error"] == "place_search_unavailable"
    assert "busy" in body["message"]


def test_places_endpoint_only_forwards_supported_languages(client, monkeypatch):
    seen: list[str] = []

    def fake_search(q, *, lang="en", limit=places.MAX_RESULTS):
        seen.append(lang)
        return []

    monkeypatch.setattr(places, "search", fake_search)
    client.get("/places", params={"q": "Wawel", "lang": "fr"})
    client.get("/places", params={"q": "Wawel", "lang": "pl"})
    assert seen == ["en", "pl"]   # "fr" falls back to English, not passed through


def test_places_endpoint_failure_does_not_break_routing(client, monkeypatch):
    """A place-search outage must never take the router down (LAY-09)."""
    def boom(q, **kw):
        raise places.GeocodeError("down")

    monkeypatch.setattr(places, "search", boom)
    assert client.get("/places", params={"q": "Wawel"}).status_code == 502
    assert client.get("/health").status_code == 200
    r = client.get("/route", params={"from": "50.0600,19.9400", "to": "50.0600,19.9460"})
    assert r.status_code == 200


