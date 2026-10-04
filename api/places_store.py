"""Quiet-places store: user-submitted places with declared quiet hours, visitor
check-ins and accuracy votes.

This is the *declared* data layer (§2O): places are added by people, their quiet
hours are a claim, and visitors confirm or dispute it. The honesty rules from
``design-requirements.md`` §2P apply even in the demo:

- Declared data is **Estimated, never Known** (BIZ-05). A place is always
  "Reported by a person" and "Not verified" unless a team member marks it
  Verified (ACC-16) — and that label is still separate from the data state
  (ACC-11).
- Votes are **opinions, not verification** (ACC-05). Enough "not accurate" votes
  mark a place **Disputed** and exclude it from calm-place suggestions; "accurate"
  votes never promote it.

Storage is stdlib ``sqlite3`` (no new dependency). The DB lives at
``DATA_DIR/places.db`` and the path is resolved lazily from the environment on
every call — mirroring ``crowds.api_key()`` — so the test fixture can point
``DATA_DIR`` at a ``tmp_path`` and reload the app in isolation.
"""
import json
import math
import os
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

KRAKOW_TZ = ZoneInfo("Europe/Warsaw")

DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

ENTRY_CONDITIONS = ("open_to_anyone", "customers_only", "ask_staff")

# The spec leaves these thresholds as [DATA]. Demo defaults, all named so they are
# easy to change together in one place.
DISPUTE_NOT_ACCURATE_MIN = 3   # "enough" not-accurate votes before Disputed (ACC-05)
CONFIRMED_VISITOR_MIN = 3      # "yes" check-ins before "Confirmed by visitors"
SHOW_COUNTS_MIN = 3            # min votes before counts are shown in words (ACC-04)

_LOCK = threading.Lock()  # sqlite3 connections are per-call; serialise writes


def db_path() -> Path:
    """Path to the SQLite file, resolved lazily from the environment each call.

    ``PLACES_DB`` (if set) points at the file directly — useful in a container,
    where the read-only routing data is baked into the image under ``DATA_DIR``
    but the mutable places DB sits on a persistent volume. Otherwise it lives
    under ``DATA_DIR`` as before.
    """
    explicit = os.environ.get("PLACES_DB")
    if explicit:
        return Path(explicit)
    env = os.environ.get("DATA_DIR")
    base = Path(env) if env else Path(__file__).resolve().parent.parent / "data"
    return base / "places.db"


def _now_krakow() -> tuple[int, int, int]:
    """(day 0=Mon..6=Sun, hour, minute) in Europe/Warsaw."""
    now = datetime.now(KRAKOW_TZ)
    return now.weekday(), now.hour, now.minute


def _utcnow() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _minutes(hhmm: str | None) -> int | None:
    """'HH:MM' -> minutes since midnight, or None if malformed."""
    if not hhmm:
        return None
    try:
        h, m = hhmm.split(":")
        return int(h) * 60 + int(m)
    except (ValueError, AttributeError):
        return None


def normalize_quiet_hours(value) -> list[dict]:
    """Validate + normalise a quiet-hours schedule into a list of windows.

    Raises ValueError with a plain-language message on any invalid entry.
    """
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError("Quiet hours must be a list of times.")
    out: list[dict] = []
    for item in value:
        if not isinstance(item, dict):
            raise ValueError("Each quiet-hours entry needs a day, start and end.")
        try:
            day = int(item["day"])
            start = str(item["start"]).strip()
            end = str(item["end"]).strip()
        except (KeyError, TypeError, ValueError):
            raise ValueError("Each quiet-hours entry needs a day (0-6), start and end.")
        if not (0 <= day <= 6):
            raise ValueError("Quiet-hours day must be 0 (Monday) to 6 (Sunday).")
        s, e = _minutes(start), _minutes(end)
        if s is None or e is None:
            raise ValueError("Quiet-hours times must be written as HH:MM.")
        if e <= s:
            raise ValueError("Quiet hours must end after they start.")
        out.append({"day": day, "start": start, "end": end})
    return out


_SCHEMA = """
CREATE TABLE IF NOT EXISTS places (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT '',
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  entry_condition TEXT NOT NULL DEFAULT 'open_to_anyone',
  quiet_hours TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  verified_at TEXT,
  verified_note TEXT
);
CREATE TABLE IF NOT EXISTS votes (
  place_id INTEGER NOT NULL REFERENCES places(id),
  device_id TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (place_id, device_id)
);
CREATE TABLE IF NOT EXISTS checkins (
  place_id INTEGER NOT NULL REFERENCES places(id),
  device_id TEXT NOT NULL,
  value TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (place_id, device_id)
);
"""


@contextmanager
def _conn():
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.executescript(_SCHEMA)
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def _vote_counts(conn, place_id: int) -> dict:
    row = conn.execute(
        "SELECT "
        "SUM(CASE WHEN value='accurate' THEN 1 ELSE 0 END) AS accurate, "
        "SUM(CASE WHEN value='not_accurate' THEN 1 ELSE 0 END) AS not_accurate "
        "FROM votes WHERE place_id = ?",
        (place_id,),
    ).fetchone()
    return {
        "accurate": int(row["accurate"] or 0),
        "not_accurate": int(row["not_accurate"] or 0),
    }


def _checkin_counts(conn, place_id: int) -> dict:
    row = conn.execute(
        "SELECT "
        "SUM(CASE WHEN value='yes' THEN 1 ELSE 0 END) AS yes, "
        "SUM(CASE WHEN value='no' THEN 1 ELSE 0 END) AS no, "
        "COUNT(*) AS total "
        "FROM checkins WHERE place_id = ?",
        (place_id,),
    ).fetchone()
    return {"yes": int(row["yes"] or 0), "no": int(row["no"] or 0), "total": int(row["total"] or 0)}


def is_disputed(votes: dict) -> bool:
    """Enough not-accurate votes, and they outnumber accurate ones (ACC-05)."""
    return (
        votes["not_accurate"] >= DISPUTE_NOT_ACCURATE_MIN
        and votes["not_accurate"] > votes["accurate"]
    )


def trust_tier(votes: dict, checkins: dict) -> str:
    """'reported' | 'confirmed' | 'disputed' — display-only, never 'known'."""
    if is_disputed(votes):
        return "disputed"
    if checkins["yes"] >= CONFIRMED_VISITOR_MIN:
        return "confirmed"
    return "reported"


def active_now(schedule: list[dict], day: int, hour: int, minute: int) -> bool:
    """True when a window covers the given time (day 0=Mon, time in Warsaw)."""
    now_min = hour * 60 + minute
    for w in schedule:
        if w.get("day") != day:
            continue
        s, e = _minutes(w.get("start")), _minutes(w.get("end"))
        if s is not None and e is not None and s <= now_min < e:
            return True
    return False


def next_window(schedule: list[dict], day: int, hour: int, minute: int) -> str | None:
    """Human label for the next quiet window, e.g. 'Tue 14:00', or None."""
    now_min = hour * 60 + minute
    best: tuple[int, int, str] | None = None
    for offset in range(8):  # look a full week ahead
        d = (day + offset) % 7
        base = offset * 24 * 60
        for w in schedule:
            if w.get("day") != d:
                continue
            s = _minutes(w.get("start"))
            if s is None:
                continue
            if offset == 0 and s <= now_min:
                continue  # this window already started today
            dist = base + s - now_min
            if best is None or dist < best[0]:
                best = (dist, d, w.get("start", ""))
    if best is None:
        return None
    return f"{DAY_NAMES[best[1]]} {best[2]}"


def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres between two WGS84 points."""
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _shape(conn, row, now: tuple[int, int, int]) -> dict:
    place_id = row["id"]
    schedule = json.loads(row["quiet_hours"] or "[]")
    votes = _vote_counts(conn, place_id)
    checkins = _checkin_counts(conn, place_id)
    return {
        "id": place_id,
        "name": row["name"],
        "type": row["type"],
        "lat": row["lat"],
        "lon": row["lon"],
        "entry_condition": row["entry_condition"],
        "quiet_hours": schedule,
        "posted_at": row["created_at"],
        "verified": bool(row["verified"]),
        "verified_at": row["verified_at"],
        "verified_note": row["verified_note"],
        "trust": trust_tier(votes, checkins),
        "disputed": is_disputed(votes),
        "vote_counts": votes,
        "checkin_counts": checkins,
        "active_now": active_now(schedule, *now),
        "next_window": next_window(schedule, *now),
    }


def create_place(*, name: str, type_: str, lat: float, lon: float,
                 entry_condition: str, quiet_hours: list[dict],
                 device_id: str) -> dict:
    with _LOCK:
        with _conn() as conn:
            cur = conn.execute(
                "INSERT INTO places (name, type, lat, lon, entry_condition, "
                "quiet_hours, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)",
                (name, type_, lat, lon, entry_condition,
                 json.dumps(quiet_hours), device_id, _utcnow()),
            )
            place_id = cur.lastrowid
            row = conn.execute("SELECT * FROM places WHERE id = ?", (place_id,)).fetchone()
            return _shape(conn, row, _now_krakow())


def get_place(place_id: int) -> dict | None:
    with _LOCK:
        with _conn() as conn:
            row = conn.execute("SELECT * FROM places WHERE id = ?", (place_id,)).fetchone()
            if row is None:
                return None
            return _shape(conn, row, _now_krakow())


def list_places(bbox: tuple[float, float, float, float] | None = None) -> list[dict]:
    with _LOCK:
        with _conn() as conn:
            if bbox:
                min_lon, min_lat, max_lon, max_lat = bbox
                rows = conn.execute(
                    "SELECT * FROM places WHERE lon >= ? AND lon <= ? "
                    "AND lat >= ? AND lat <= ? ORDER BY id",
                    (min_lon, min_lat, max_lon, max_lat),
                ).fetchall()
            else:
                rows = conn.execute("SELECT * FROM places ORDER BY id").fetchall()
            now = _now_krakow()
            return [_shape(conn, r, now) for r in rows]


def vote(place_id: int, device_id: str, value: str) -> dict:
    with _LOCK:
        with _conn() as conn:
            row = conn.execute("SELECT id FROM places WHERE id = ?", (place_id,)).fetchone()
            if row is None:
                return {}
            conn.execute(
                "INSERT INTO votes (place_id, device_id, value, created_at) "
                "VALUES (?,?,?,?) "
                "ON CONFLICT(place_id, device_id) DO UPDATE SET value=excluded.value, "
                "created_at=excluded.created_at",
                (place_id, device_id, value, _utcnow()),
            )
            row = conn.execute("SELECT * FROM places WHERE id = ?", (place_id,)).fetchone()
            return _shape(conn, row, _now_krakow())


def checkin(place_id: int, device_id: str, value: str | None) -> dict:
    with _LOCK:
        with _conn() as conn:
            row = conn.execute("SELECT id FROM places WHERE id = ?", (place_id,)).fetchone()
            if row is None:
                return {}
            conn.execute(
                "INSERT INTO checkins (place_id, device_id, value, created_at) "
                "VALUES (?,?,?,?) "
                "ON CONFLICT(place_id, device_id) DO UPDATE SET value=excluded.value, "
                "created_at=excluded.created_at",
                (place_id, device_id, value, _utcnow()),
            )
            row = conn.execute("SELECT * FROM places WHERE id = ?", (place_id,)).fetchone()
            return _shape(conn, row, _now_krakow())


def verify(place_id: int, *, verified: bool, note: str | None) -> dict | None:
    with _LOCK:
        with _conn() as conn:
            row = conn.execute("SELECT id FROM places WHERE id = ?", (place_id,)).fetchone()
            if row is None:
                return None
            if verified:
                conn.execute(
                    "UPDATE places SET verified = 1, verified_at = ?, verified_note = ? WHERE id = ?",
                    (_utcnow(), note, place_id),
                )
            else:
                conn.execute(
                    "UPDATE places SET verified = 0, verified_at = NULL, verified_note = NULL WHERE id = ?",
                    (place_id,),
                )
            row = conn.execute("SELECT * FROM places WHERE id = ?", (place_id,)).fetchone()
            return _shape(conn, row, _now_krakow())


def calm_candidates(lat: float, lon: float, *, day: int | None = None,
                    hour: int | None = None, minute: int = 0,
                    limit: int = 5) -> list[dict]:
    """Eligible calm places: quiet hours active now and not disputed.

    Sorted by straight-line distance; walk time is distance ÷ 5 km/h (labelled an
    estimate — it is not a routed distance).
    """
    if day is None or hour is None:
        day, hour, minute = _now_krakow()
    with _LOCK:
        with _conn() as conn:
            rows = conn.execute("SELECT * FROM places").fetchall()
            now = (day, hour, minute)
            out = []
            for r in rows:
                schedule = json.loads(r["quiet_hours"] or "[]")
                if not active_now(schedule, day, hour, minute):
                    continue
                shaped = _shape(conn, r, now)
                if shaped["disputed"]:
                    continue
                dist = _haversine(lat, lon, r["lat"], r["lon"])
                shaped["distance_m"] = round(dist)
                shaped["walk_min"] = max(1, round(dist / 5000.0 * 60.0))
                out.append(shaped)
            out.sort(key=lambda p: p["distance_m"])
            return out[:limit]
