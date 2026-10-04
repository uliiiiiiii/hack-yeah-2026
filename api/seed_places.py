"""One-off: seed the quiet-places DB with the Kraków "quiet hours" list.

Source: "Ciche godziny — lista miejsc"
https://atypowadziewczyna.wordpress.com/2023/08/25/ciche-godziny-lista-miejsc-2/

Only Kraków entries are seeded (the source list also covers other Polish cities
and national shop chains, which are out of scope). Coordinates were resolved via
OpenStreetMap Nominatim and are pinned here so re-running is deterministic.

Entries whose schedule is *irregular* (e.g. "first Wednesday of the month",
specific calendar dates) are skipped — the store models a weekly day + time
window, so they do not fit. "Park Wola" is omitted because it could not be
geocoded to a retail centre (only the Wola amusement park / a nature park match).

Run with the api venv:  api/.venv/bin/python api/seed_places.py
"""
import sys

import places_store

# day 0=Mon..6=Sun. Tue=1, Wed=2, Sun=6.
PLACES = [
    {
        "name": "Galeria Bronowice",
        "type": "Shopping centre",
        "lat": 50.0920871, "lon": 19.8982842,
        "entry_condition": "open_to_anyone",
        "quiet_hours": [{"day": 1, "start": "15:00", "end": "17:00"}],
    },
    {
        "name": "M1 Kraków",
        "type": "Shopping centre",
        "lat": 50.0638374, "lon": 19.9995483,
        "entry_condition": "open_to_anyone",
        "quiet_hours": [{"day": 1, "start": "15:00", "end": "17:00"}],
    },
    {
        "name": "Park Handlowy Zakopianka",
        "type": "Shopping centre",
        "lat": 50.0150251, "lon": 19.9319630,
        "entry_condition": "open_to_anyone",
        "quiet_hours": [{"day": 1, "start": "15:00", "end": "17:00"}],
    },
    {
        "name": "Muzeum Podgórza",
        "type": "Museum",
        "lat": 50.0425470, "lon": 19.9609479,
        "entry_condition": "open_to_anyone",
        "quiet_hours": [{"day": 6, "start": "15:00", "end": "17:00"}],
    },
    {
        "name": "MOCAK Muzeum Sztuki Współczesnej",
        "type": "Museum",
        "lat": 50.0478769, "lon": 19.9613687,
        "entry_condition": "open_to_anyone",
        "quiet_hours": [{"day": 2, "start": "16:00", "end": "19:00"}],
    },
    {
        "name": "Bunkier Sztuki",
        "type": "Gallery",
        "lat": 50.0635805, "lon": 19.9344469,
        "entry_condition": "open_to_anyone",
        "quiet_hours": [{"day": 1, "start": "12:00", "end": "15:00"}],
    },
    {
        "name": "Muzeum Etnograficzne w Krakowie",
        "type": "Museum",
        "lat": 50.0486624, "lon": 19.9434852,
        "entry_condition": "open_to_anyone",
        "quiet_hours": [{"day": 2, "start": "16:00", "end": "19:00"}],
    },
]


def main() -> int:
    existing = {p["name"] for p in places_store.list_places()}
    added = 0
    for item in PLACES:
        if item["name"] in existing:
            print(f"skip (already present): {item['name']}")
            continue
        p = places_store.create_place(
            name=item["name"],
            type_=item["type"],
            lat=item["lat"],
            lon=item["lon"],
            entry_condition=item["entry_condition"],
            quiet_hours=item["quiet_hours"],
            device_id="seed:quiet-hours",
        )
        added += 1
        print(f"added #{p['id']} {p['name']}  ({item['lat']:.5f}, {item['lon']:.5f})  "
              f"next={p['next_window']}")
    print(f"\n{added} added, {len(PLACES) - added} skipped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
