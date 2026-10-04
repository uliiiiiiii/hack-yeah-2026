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

## Sensory routing — "pick the issues that affect you"

Beyond `shortest`, the API has a **`sensory`** profile: the user selects which
issues matter to them and we route around them, always **flagging where the data
is unknown** (missing data is never treated as "good"). Factors combine into one
cost; `strength` (low/medium/high) sets how hard we avoid them.

| Factor | Request | Data source | Coverage / honesty |
|---|---|---|---|
| **Noise** | `noise=on` | Kraków 2022 strategic acoustic map (road-traffic LDWN/Lden), sampled per edge by `etl/build_noise.py` | **Real, ~100% of the network.** 48% is quiet (<55 dB), ~6% very loud (75-80+). |
| **Light** | `light=prefer_lit` or `light=avoid_bright` | OSM `lit` tag | Bidirectional: prefer well-lit (e.g. night safety) *or* avoid bright (sensory). ~30% of streets tagged; the rest is flagged unknown. |
| **Crowds** | `crowd=on` | [BestTime.app](https://besttime.app) live foot traffic | Current busyness, refreshed ~20 min. Venue-based, so coverage depends on how many venues you seed (see below). |

Example: `GET /route?from=50.06,19.94&to=50.05,19.95&profile=sensory&noise=on&light=prefer_lit&strength=high`

The response adds `exposure` (per-factor stats), `uncertainty` (per-factor
`unknown_pct`), and `uncertain_segments` (sub-paths the web app draws **dashed**).
`GET /health` reports which factors are available.

### Accessible, low-stimulation UI (`design-requirements.md`)

The web/mobile client implements the design spec in `design-requirements.md`
(WCAG 2.2 AA target, aimed at neurodivergent and sensory-sensitive users):

- **Design tokens** (§3): muted light/dark palettes with the exact hex values and
  contrast ratios, colour-vision-safe route colours (A blue / Shortest grey, each
  with a letter badge + line style, never colour alone), theme = device by default
  with a user override and no flash, forced-colours and reduced-motion support.
- **Main-screen anatomy** (§4): Start/Destination fields + Swap, Settings/Help, a
  `When` (Now / Leave at) selector, a map with 44 px Zoom/Locate/Legend/Layers
  controls, a half-open bottom sheet with the profile row (Noise & Crowds toggles,
  a three-state Light control, Adjust), Compare, route cards and one full-width
  primary button, plus the outlined **"I don't feel well"** pill.
- **Data honesty** (§2E): per-factor coverage in words (never averaged), `~` for
  typical/estimated crowds, and no-data stretches drawn dashed with a `?` marker
  and listed for non-visual access. No data is never worded as quiet/dim/empty.
- **Settings** (§2C/F9): theme, text size (to 200%), low-stimulation, reduce
  motion, strictness, alerts, language, on-device only, with reset and delete.
- **Overwhelm flow** (F13): a calm screen that — honestly, because we have no
  vetted calm-place dataset yet — says it doesn't know of a calm place nearby and
  offers Stay here and Call 112, rather than inventing a suggestion.

Deferred (need backend/data, or production-only per the spec's own §2P demo
scope): the business portal (F14–F18), persisted accuracy-vote/verification store,
a real calm-place dataset, city-wide factor heatmap overlays, and turn-by-turn
guidance (F5).

### Crowds via BestTime (optional)

Needs an API key — put it in the **repo-root `.env`** (gitignored; read only by the
API, never shipped to the app):

```bash
BESTTIME_API_KEY_PRIVATE=pri_...     # in .env, then restart the API
```

`/venues/filter` returns venues from BestTime's **whole database** in the Kraków
area (not just ones you added), so you usually get good coverage with **no
seeding** — we query up to 500 venues (`VENUE_LIMIT` in `api/crowds.py`), which
costs only a cheap query credit, not forecast credits. Central Kraków ends up ~90%
covered; outer districts less, and those stretches are flagged "no crowd data".

Only if you want to *add* specific venues that aren't in BestTime yet, seed them
(this costs **2 forecast credits per venue**):

```bash
make seed-crowds      # etl/seed_besttime.py — venue searches, background-processed
```

Busyness is a **forecast** (typical for the current day/hour), not live — the UI
labels it "typical for now". Without a key the crowds factor is hidden in the UI
and rejected by the API.

**Leave at (future times).** The `When` selector can route for a future hour;
the API fetches a per-hour crowd layer (`when_day`/`when_hour`, cached). Fetching a
*new* day/hour costs a BestTime credit — if the account's free credits are
exhausted the request returns `409 quota_exhausted`, and we honestly fall back to
**No data** for that time (never the current snapshot relabelled). The current hour
keeps working because it is already forecast in the account.

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