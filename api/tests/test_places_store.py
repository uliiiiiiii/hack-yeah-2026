"""Tests for the quiet-places store (declared data, votes, check-ins).

Pure logic + SQLite — no HTTP. Each test points DATA_DIR at a fresh tmp_path, so
the DB is empty and isolated. ``places_store.db_path()`` reads the env lazily, so
no reload is needed between tests.
"""
import pytest

import places_store


@pytest.fixture(autouse=True)
def fresh_db(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    yield


def make_place(*, name="Cafe Miła", quiet_hours=None, lat=50.0610, lon=19.9370,
               device_id="dev-1", **kw):
    return places_store.create_place(
        name=name,
        type_=kw.pop("type_", "Cafe"),
        lat=lat,
        lon=lon,
        entry_condition=kw.pop("entry_condition", "open_to_anyone"),
        quiet_hours=quiet_hours if quiet_hours is not None
        else [{"day": 0, "start": "09:00", "end": "17:00"}],
        device_id=device_id,
    )


# ---- schedule validation ----

def test_normalize_accepts_a_valid_schedule():
    out = places_store.normalize_quiet_hours([{"day": 3, "start": "09:00", "end": "17:00"}])
    assert out == [{"day": 3, "start": "09:00", "end": "17:00"}]


def test_normalize_rejects_bad_day():
    with pytest.raises(ValueError):
        places_store.normalize_quiet_hours([{"day": 7, "start": "09:00", "end": "17:00"}])


def test_normalize_rejects_end_before_start():
    with pytest.raises(ValueError):
        places_store.normalize_quiet_hours([{"day": 0, "start": "17:00", "end": "09:00"}])


def test_normalize_rejects_malformed_time():
    with pytest.raises(ValueError):
        places_store.normalize_quiet_hours([{"day": 0, "start": "9am", "end": "17:00"}])


# ---- active_now / next_window ----

def test_active_now_inside_window():
    s = [{"day": 0, "start": "09:00", "end": "17:00"}]
    assert places_store.active_now(s, 0, 12, 0) is True
    assert places_store.active_now(s, 0, 8, 59) is False
    assert places_store.active_now(s, 0, 17, 0) is False  # end is exclusive
    assert places_store.active_now(s, 1, 12, 0) is False  # wrong day


def test_next_window_same_day_then_next_day_then_wraps():
    s = [{"day": 1, "start": "09:00", "end": "17:00"}]  # Tue only
    assert places_store.next_window(s, 1, 8, 0) == "Tue 09:00"
    assert places_store.next_window(s, 0, 12, 0) == "Tue 09:00"  # next Tue after Mon
    assert places_store.next_window(s, 1, 18, 0) == "Tue 09:00"  # next week


def test_next_window_none_when_no_schedule():
    assert places_store.next_window([], 0, 12, 0) is None


# ---- create / get / list ----

def test_create_and_get_round_trip():
    p = make_place()
    assert p["id"] == 1
    assert p["name"] == "Cafe Miła"
    assert p["trust"] == "reported"
    assert p["verified"] is False
    got = places_store.get_place(1)
    assert got["name"] == "Cafe Miła"


def test_list_returns_created_places():
    make_place(name="A")
    make_place(name="B", lat=50.08, lon=19.99)
    names = {p["name"] for p in places_store.list_places()}
    assert names == {"A", "B"}


def test_get_missing_returns_none():
    assert places_store.get_place(999) is None


# ---- votes: opinions, dedup, dispute ----

def test_vote_upserts_one_row_per_device():
    p = make_place()
    places_store.vote(1, "dev-1", "not_accurate")
    places_store.vote(1, "dev-1", "not_accurate")  # repeat -> still one vote
    got = places_store.get_place(1)
    assert got["vote_counts"] == {"accurate": 0, "not_accurate": 1}


def test_vote_changes_an_existing_vote():
    make_place()
    places_store.vote(1, "dev-1", "not_accurate")
    places_store.vote(1, "dev-1", "accurate")
    got = places_store.get_place(1)
    assert got["vote_counts"] == {"accurate": 1, "not_accurate": 0}


def test_dispute_requires_majority_and_minimum():
    assert places_store.is_disputed({"accurate": 0, "not_accurate": 2}) is False
    assert places_store.is_disputed({"accurate": 0, "not_accurate": 3}) is True
    # not_accurate must strictly outnumber accurate
    assert places_store.is_disputed({"accurate": 3, "not_accurate": 3}) is False


def test_trust_tier_confirmed_by_visitors():
    make_place()
    for d in ("a", "b", "c"):
        places_store.checkin(1, d, "yes")
    assert places_store.get_place(1)["trust"] == "confirmed"


# ---- check-ins ----

def test_checkin_upserts_one_row_per_device():
    make_place()
    places_store.checkin(1, "dev-1", "yes")
    places_store.checkin(1, "dev-1", "no")  # change answer
    places_store.checkin(1, "dev-2", None)  # presence only
    got = places_store.get_place(1)
    assert got["checkin_counts"] == {"yes": 0, "no": 1, "total": 2}


# ---- calm candidates ----

def _all_week():
    return [{"day": d, "start": "00:00", "end": "23:59"} for d in range(7)]


def test_calm_candidates_includes_active_undisputed_and_orders_by_distance():
    near = make_place(name="Near", lat=50.0610, lon=19.9370, quiet_hours=_all_week())
    far = make_place(name="Far", lat=50.0700, lon=19.9600, quiet_hours=_all_week())
    out = places_store.calm_candidates(50.0610, 19.9370, day=0, hour=12)
    names = [p["name"] for p in out]
    assert names[0] == "Near" and names[1] == "Far"
    assert out[0]["distance_m"] < out[1]["distance_m"]


def test_calm_candidates_excludes_disputed():
    make_place(name="Disputed", quiet_hours=_all_week())
    for d in ("a", "b", "c"):
        places_store.vote(1, d, "not_accurate")
    out = places_store.calm_candidates(50.0610, 19.9370, day=0, hour=12)
    assert out == []


def test_calm_candidates_excludes_inactive_hours():
    make_place(name="Inactive", quiet_hours=[{"day": 0, "start": "09:00", "end": "17:00"}])
    # Outside the window on Tuesday -> nothing active.
    out = places_store.calm_candidates(50.0610, 19.9370, day=1, hour=12)
    assert out == []
