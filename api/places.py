"""Place-name search, proxied from OpenStreetMap Nominatim (free, no API key).

Why the browser does not call Nominatim directly:

1. **Usage policy.** Nominatim's public service asks apps to "set up a proxy and
   also enable caching of requests", and caps *all* traffic from one application
   at 1 request per second. It also explicitly forbids building auto-complete
   search on the client side over the public API. So the web app submits a
   query instead of searching on every keystroke, and this module is the proxy.
2. **Identification.** The policy requires a valid User-Agent or Referer
   identifying the application. Our page is statically exported and runs inside
   a Capacitor WebView (origin ``https://localhost`` / ``capacitor://localhost``),
   which cannot reliably send a policy-compliant Referer. We set the User-Agent.
3. **Caching and throttling.** Repeat lookups never reach OSMF's donated
   servers, and outbound calls are spaced at least ``MIN_INTERVAL_S`` apart.

Results are bounded to the Kraków viewbox so they line up with the area the
router actually covers. Data © OpenStreetMap contributors (ODbL), so the caller
must display attribution — the web app does so next to the suggestions.

See https://operations.osmfoundation.org/policies/nominatim/
"""
import os
import re
import threading
import time
import unicodedata
from dataclasses import dataclass, field

import requests

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"

# Required by the policy: identify the application. Override when you fork this.
USER_AGENT = os.environ.get(
    "GEOCODER_USER_AGENT",
    "Ciszej/0.1 (hackathon prototype; https://github.com/hack-yeah-2026)",
)

# left(lon), top(lat), right(lon), bottom(lat) — the Kraków agglomeration,
# matching the routing graph's coverage so results are actually routable.
KRAKOW_VIEWBOX = "19.79,50.16,20.25,49.95"

MIN_INTERVAL_S = 1.05   # policy: absolute maximum of 1 request per second
CACHE_TTL_S = 3600      # policy: "results must be cached on your side"
TIMEOUT_S = 10.0
MAX_QUERY_LEN = 120
MAX_RESULTS = 6
MIN_QUERY_LEN = 2


# Polish addresses are nearly always typed with the street-type prefix
# ("ul. Sienna 5", "al. Focha 12"). Nominatim does not understand the prefix and
# returns nothing for it, so drop it before querying.
_STREET_PREFIX = re.compile(
    r"^\s*(?:ul|ulica|al|aleja|aleje|pl|plac|os|osiedle|skrzyżowanie|skrzyzowanie"
    r"|rondo|rond|bulw|bulwar|pasaż|pasaz|droga|dr)\.?\s+",
    re.IGNORECASE,
)

# A query that ends in a number is an address lookup, so results that ARE an
# address rank above a shop or venue that merely sits at that address.
_HOUSE_NUMBER_TAIL = re.compile(r"\d+[a-zA-Z]?\s*$", re.IGNORECASE)
_ADDRESS_TYPES = frozenset({
    "house", "building", "address", "house_number", "residential", "apartments",
})

# display_name is "5, Sienna, Old Town, ...", so the house number sits first.
_HOUSE_NUMBER_PART = re.compile(r"^\d+[a-zA-Z]?(?:/\d+[a-zA-Z]?)?$")

# OSM `address` keys that name a street, most specific first.
_ROAD_KEYS = ("road", "pedestrian", "footway", "living_street", "residential", "path")


def strip_street_prefix(query: str) -> str:
    """Drop a leading Polish street-type prefix: "ul. Sienna 5" -> "Sienna 5"."""
    stripped = _STREET_PREFIX.sub("", query, count=1).strip()
    # Only accept the stripped form if it is still a usable query.
    return stripped if len(stripped) >= MIN_QUERY_LEN else query


def looks_like_address(query: str) -> bool:
    """True when the query ends in a house number, e.g. "Sienna 5"."""
    return bool(_HOUSE_NUMBER_TAIL.search(query.strip()))


def _first_str(*values) -> str:
    for v in values:
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


class GeocodeError(Exception):
    """The upstream geocoder failed, was unreachable, or is rate-limiting us."""


# Letters that NFKD does not decompose, so they need an explicit mapping.
# Polish "ł" is the important one here: typing "Lagiewniki" must find "Łagiewniki".
_FOLD_EXTRA = str.maketrans({
    "ł": "l", "Ł": "L",
    "đ": "d", "Đ": "D",
    "ø": "o", "Ø": "O",
    "æ": "ae", "Æ": "AE",
    "œ": "oe", "Œ": "OE",
    "ß": "ss",
    "’": "'", "‘": "'", "“": '"', "”": '"',
    "–": "-", "—": "-",
})


def fold(text: str) -> str:
    """Lowercase and strip diacritics: "Łagiewniki" -> "lagiewniki" (INP-01)."""
    decomposed = unicodedata.normalize("NFKD", text).translate(_FOLD_EXTRA)
    without_marks = "".join(c for c in decomposed if not unicodedata.combining(c))
    return " ".join(without_marks.lower().split())


@dataclass
class _Cache:
    """TTL cache + outbound rate limiter, shared by every request handler."""
    ttl_s: float = CACHE_TTL_S
    entries: dict = field(default_factory=dict)
    lock: threading.Lock = field(default_factory=threading.Lock)
    _next_free: float = 0.0

    def get(self, key: str):
        """Return the cached list, or None on a miss. An empty list is a hit."""
        with self.lock:
            hit = self.entries.get(key)
            if hit is not None and (time.time() - hit[0]) < self.ttl_s:
                return hit[1]
            return None

    def put(self, key: str, value: list) -> None:
        with self.lock:
            self.entries[key] = (time.time(), value)

    def reserve_slot(self) -> float:
        """Reserve the next outbound slot, returning how long to wait (seconds).

        Reserving under the lock means concurrent handlers queue up instead of
        firing at Nominatim together, which is what the 1 req/s cap requires.
        """
        with self.lock:
            now = time.time()
            start = max(now, self._next_free)
            self._next_free = start + MIN_INTERVAL_S
            return start - now


CACHE = _Cache()


def _fetch(query: str, lang: str, limit: int) -> list[dict]:
    """One upstream call, rate-limited. Raises GeocodeError on any failure."""
    params = {
        "format": "jsonv2",
        "q": query,
        "limit": str(limit),
        # Structured road/house_number/suburb, so a house address can be labelled
        # "Sienna 5" instead of a bare "5".
        "addressdetails": "1",
        "viewbox": KRAKOW_VIEWBOX,
        "bounded": "1",
        "accept-language": lang,
    }
    wait = CACHE.reserve_slot()
    if wait > 0:
        time.sleep(wait)
    try:
        res = requests.get(
            NOMINATIM_URL,
            params=params,
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            timeout=TIMEOUT_S,
        )
    except requests.RequestException as exc:
        raise GeocodeError("Could not reach the place search service.") from exc

    if res.status_code == 429:
        raise GeocodeError("Place search is busy. Try again in a moment.")
    if res.status_code in (401, 403):
        raise GeocodeError("Place search is not available right now.")
    if not res.ok:
        raise GeocodeError(f"Place search failed (status {res.status_code}).")
    try:
        rows = res.json()
    except ValueError as exc:
        raise GeocodeError("Place search returned an answer we could not read.") from exc
    return rows if isinstance(rows, list) else []


def _shape(row: dict) -> tuple[dict, bool] | None:
    """Turn one Nominatim row into (place, is_address), or None if unusable.

    ``is_address`` marks results that *are* an address, so a query like
    "Krakowska 1" ranks the house above a venue that merely sits there.
    """
    try:
        lat = float(row["lat"])
        lon = float(row["lon"])
    except (KeyError, TypeError, ValueError):
        return None
    if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
        return None

    addr = row.get("address") or {}
    road = _first_str(*(addr.get(k) for k in _ROAD_KEYS))
    house = _first_str(addr.get("house_number"))
    name = _first_str(row.get("name"))
    parts = [p.strip() for p in str(row.get("display_name") or "").split(",") if p.strip()]

    if name:
        label = name
    elif road and house:
        # House addresses come back with an EMPTY `name`, and display_name leads
        # with the house number — so composing "Sienna 5" is what makes an
        # address search read as an address instead of just "5".
        label = f"{road} {house}"
    elif road:
        label = road
    elif parts and _HOUSE_NUMBER_PART.match(parts[0]) and len(parts) > 1:
        label = f"{parts[1]} {parts[0]}"
    else:
        label = parts[0] if parts else ""
    if not label:
        return None

    # Context line: the district and city if the structured data has them,
    # otherwise whatever follows the label in the display name.
    detail_bits = [
        b for b in (
            _first_str(addr.get("suburb")),
            _first_str(addr.get("city_district"), addr.get("borough")),
            _first_str(addr.get("city"), addr.get("town"), addr.get("village")),
        ) if b
    ]
    if not detail_bits:
        detail_bits = [p for p in parts if p != label]

    is_address = str(row.get("type") or "").lower() in _ADDRESS_TYPES
    place = {"label": label, "detail": ", ".join(detail_bits[:3]), "lat": lat, "lon": lon}
    return place, is_address


def _shape_all(rows: list[dict]) -> list[dict]:
    """Shape every usable row, dropping the internal is_address marker."""
    shaped = (_shape(row) for row in rows if isinstance(row, dict))
    return [place for pair in shaped if pair is not None for place in (pair[0],)]


def _rank(rows: list[dict], want_addresses: bool) -> list[dict]:
    """Shape rows and, for an address query, float real addresses to the top.

    Without this, "Krakowska 1" returns a venue at that address first and the
    house the user actually typed may not appear at all.
    """
    shaped = (_shape(row) for row in rows if isinstance(row, dict))
    pairs = [p for p in shaped if p is not None]
    if want_addresses:
        # Stable sort: Nominatim's own relevance order is preserved within
        # each of the two groups.
        pairs.sort(key=lambda pair: not pair[1])
    return [place for place, _ in pairs]


def search(query: str, *, lang: str = "en", limit: int = MAX_RESULTS) -> list[dict]:
    """Search Kraków places by name or address. Cached; ≤1 upstream call/sec.

    Returns a list of ``{label, detail, lat, lon}``. Raises GeocodeError if the
    upstream service is unreachable — callers turn that into a user-facing error
    rather than pretending there are no results.
    """
    q = " ".join(query.split())
    if len(q) < MIN_QUERY_LEN:
        return []
    # Polish street prefixes ("ul. ", "al. ") mean nothing to Nominatim.
    q = strip_street_prefix(q)[:MAX_QUERY_LEN]
    limit = max(1, min(int(limit), MAX_RESULTS))
    want_addresses = looks_like_address(q)

    key = f"{fold(q)}|{lang}|{limit}"
    cached = CACHE.get(key)
    if cached is not None:
        return cached

    places = _rank(_fetch(q, lang, limit), want_addresses)

    # Diacritic fallback (INP-01: "Lagiewniki" must find "Łagiewniki"). Nominatim
    # usually folds these itself, so this costs one extra call only when the exact
    # spelling found nothing. The result is cached under the original key.
    if not places:
        folded = fold(q)
        if folded and folded != q.lower():
            places = _rank(_fetch(folded, lang, limit), want_addresses)

    CACHE.put(key, places)
    return places


ATTRIBUTION = "© OpenStreetMap contributors"



