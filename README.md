# Kraków walking-route planner (skeleton)

Click two points on a map of Kraków and get a walking route back from our own API.
Routing runs on an OpenStreetMap walking graph with **pluggable edge costs**: a
"profile" is just a function from edge columns to a cost multiplier, so new data
sources (noise, accessibility, …) can be added later without touching the plumbing.

Everything here is free and open-source. No API keys, no paid services.

```
project/
  etl/   download the OSM walk network -> data/nodes.parquet, data/edges.parquet
  api/   FastAPI service that routes over the parquet files (no osmnx at runtime)
  web/   Next.js + MapLibre map UI (dumb client: sends two points, draws the line)
  data/  generated files (gitignored)
```

## Architecture in one paragraph

The ETL writes two parquet files. `edges.parquet` is the **single source of truth**
for routing. The API loads them once, builds a `scipy.sparse` cost matrix per
profile (parallel edges reduced to the cheapest first, because CSR construction
sums duplicates), and runs Dijkstra. The web app contains no routing logic — it
sends `from`/`to` and draws the GeoJSON that comes back. Missing OSM tags are kept
as nulls everywhere; a missing tag means *unknown*, never *good*.

## Prerequisites

- **Python 3.11+** (developed on 3.12).
- **Node 20+** (developed on 20.19). If you use `nvm`, the `make web` target
  activates Node 20 automatically.
- Internet access for the first ETL run (OSM download) and for map tiles
  (OpenFreeMap) in the browser.

## From a clean checkout to a running app

```bash
# 1. Create virtualenvs + install all dependencies (Python and web)
make setup

# 2. Build the data: downloads the Kraków walk network, writes the parquet files
#    (first run downloads ~180 MB of OSM data; subsequent runs reuse the graphml)
make data

# 3. Run the API on http://localhost:8000
make api
```

In a second terminal:

```bash
# 4. Run the web app on http://localhost:3000
make web
```

Open http://localhost:3000, click a start point (A) and a destination (B), and a
route is drawn with a summary. You can also type two `lat, lon` pairs and press
**Get route**, or drag the A/B markers to re-route.

### Other make targets

| target  | what it does                                              |
|---------|-----------------------------------------------------------|
| `setup` | create `etl/.venv` and `api/.venv`, install deps, `npm install` in `web/` |
| `data`  | `build_graph.py` then `build_edges.py`                    |
| `api`   | `uvicorn main:app --reload --port 8000` from `api/`       |
| `web`   | `npm run dev` (Node 20 via nvm) from `web/`               |
| `audit` | run `audit_physical.py` and `audit_tradeoff.py`           |
| `test`  | run the API test suite (`pytest`)                         |
| `clean` | remove generated `data/` files (keeps the venvs)          |

You can run the sub-steps by hand too, e.g. `cd api && .venv/bin/python -m pytest`.

## API

```
GET /route?from=lat,lon&to=lat,lon&profile=shortest
GET /health
```

Success is a GeoJSON `Feature` (LineString, `[lon, lat]`) with `profile`,
`length_m`, `duration_min_estimate` (5 km/h), `edge_count`, `summary`, and
`data_built_at`. Errors are `{ "error": code, "message": text }`:
`bad_request` (400), `out_of_area` (422), `no_route` (404).

### Adding a routing profile

Edit `api/profiles.py`: write a function `f(edges: pd.DataFrame) -> np.ndarray`
returning one multiplier (>= 1.0, or `np.inf` to exclude) per edge, and register
it in the `PROFILES` dict. It is exposed automatically via `?profile=<key>`.
Only `shortest` (all ones) is implemented now.

## Audits

`make audit` runs two scripts in `etl/` and writes CSVs to `data/`:

- `audit_physical.py` — share of the network (by length) with each
  accessibility-relevant OSM tag, overall and by highway class, plus steps and
  crossing/kerb coverage.
- `audit_tradeoff.py` — samples O/D pairs and compares shortest vs penalised
  routes (extra distance vs exposure reduction). With no real penalty column it
  uses a crude road-class **placeholder** that is a pipeline test only, not a
  finding. Point it at a real 0–1 column later with `--penalty-col <name>`.

## Mobile (Android, via Capacitor)

The web app is also wrapped with [Capacitor](https://capacitorjs.com/) to run as a
native Android app (the exported static site runs inside a native WebView; the map
and routing work the same). This is an addition on top of the original spec.

```bash
# one-time: point the app at your computer's LAN IP (a phone can't reach localhost)
echo 'NEXT_PUBLIC_API_URL=http://<your-LAN-IP>:8000' > web/.env.local

make api-lan        # run the API bound to 0.0.0.0 so the phone can reach it
make mobile-apk     # export + Capacitor sync + build debug APK (needs Node 22, Android SDK)
# -> web/android/app/build/outputs/apk/debug/app-debug.apk
```

Full details, prerequisites, and the "open in Android Studio" flow are in
[`web/README-mobile.md`](web/README-mobile.md). Needs **Node 22+** (Capacitor CLI),
**Java 21**, and an **Android SDK**; the web app alone only needs Node 20+.

## Configuration

See `.env.example` (root) and `web/.env.example`. All values have working
defaults; no `.env` file is required for local use.

| variable | used by | default |
|---|---|---|
| `ALLOWED_ORIGINS` | api (CORS) | `http://localhost:3000` |
| `DATA_DIR` | api | `../data` |
| `NEXT_PUBLIC_API_URL` | web | `http://localhost:8000` |
| `NEXT_PUBLIC_MAP_STYLE_URL` | web | `https://tiles.openfreemap.org/styles/liberty` |

Map data © OpenStreetMap contributors (ODbL); the attribution control is kept
visible in the UI as the licence requires.