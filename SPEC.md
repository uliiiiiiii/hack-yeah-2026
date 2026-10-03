# Project setup spec: walking-route planner for Kraków (initial skeleton)

## Goal

Build a working skeleton: click two points on a map of Kraków, get a walking route back from our own API. Routing uses an OpenStreetMap walking graph. Edge costs must be pluggable, because the weighting (noise vs physical accessibility) is not decided yet.

Do the work in the order: root, etl, api, web, audits. Get each stage working before starting the next.

## Principles

1. Free and open-source components only. No API keys. No paid services.
2. The web app is dumb. It sends two points and draws what comes back. All logic lives in the API.
3. The edge table is the single source of truth for routing. A "profile" is a function from edge columns to a cost multiplier. Adding a data source later must not change the plumbing.
4. Missing data is not good data. Never fill unknown tag values with defaults. Keep nulls as nulls.
5. Keep it simple. No database, no auth, no Docker in this phase.

## Out of scope for this phase

Noise data, light data, crowd data, user accounts, reports, venues or places, PostGIS, tile hosting, deployment, i18n.

## Repo layout

```
project/
  README.md
  Makefile
  .gitignore            data/ (except data/.gitkeep), .env, node_modules, __pycache__, .venv
  .env.example
  data/                 generated files, gitignored
  etl/
  api/
  web/
```

Python 3.11 or newer. Node 20 or newer.

## Shared contracts

### data/nodes.parquet

| column | type | notes |
|---|---|---|
| node_idx | int | contiguous 0..N-1, used everywhere instead of OSM IDs |
| osm_id | int | original OSM node ID |
| lat, lon | float | WGS84 |
| highway, crossing, kerb | string, nullable | raw OSM tags if present |

### data/edges.parquet (GeoParquet, EPSG:4326)

| column | type | notes |
|---|---|---|
| edge_idx | int | contiguous 0..M-1 |
| u_idx, v_idx | int | node_idx of start and end |
| length_m | float | from OSMnx |
| name | string, nullable | street name |
| highway | string | list values joined with ";" |
| surface, smoothness, incline, width, lit, maxspeed, wheelchair, step_count | string, nullable | raw OSM tags, list values joined with ";", never filled or parsed |
| geometry | LineString | oriented from u to v |

Both files must be produced by the ETL and read by the API. The API must not need osmnx or the graphml file.

### API: GET /route

Query parameters: `from=lat,lon`, `to=lat,lon`, `profile=shortest` (default).

Success (200): GeoJSON Feature, geometry LineString in [lon, lat] order, with properties:

```json
{
  "profile": "shortest",
  "length_m": 1432.5,
  "duration_min_estimate": 17,
  "edge_count": 58,
  "summary": "About 1.4 km, roughly 17 minutes on foot.",
  "data_built_at": "2026-10-03T12:00:00Z"
}
```

Errors return JSON `{ "error": "<code>", "message": "<human text>" }`:

- 400 `bad_request`: malformed or missing coordinates, or unknown profile.
- 422 `out_of_area`: a point is more than 500 m from the nearest graph node.
- 404 `no_route`: no path between the two nodes.

## Folder: etl/

Purpose: download the Kraków walking network and write the two parquet files.

Requirements:

1. `requirements.txt` with: osmnx, geopandas, pandas, pyarrow, numpy, scipy, shapely. Pin versions after first successful run.
2. `build_graph.py`
   - Before downloading, set `ox.settings.useful_tags_way` to include at least: highway, surface, smoothness, incline, width, lit, maxspeed, wheelchair, step_count, name, oneway. Set `ox.settings.useful_tags_node` to include highway, crossing, kerb. OSMnx drops other tags by default, so this step is mandatory.
   - Download with `ox.graph_from_place("Kraków, Poland", network_type="walk")`. Geocoding can return the wrong polygon, so print the polygon area. Kraków should be roughly 327 km². If it is far off, fall back to an explicit bounding box and say so in the log.
   - Save to `data/krakow_walk.graphml`. Skip the download if the file exists, unless run with `--force`.
3. `build_edges.py`
   - Load the graphml, convert to GeoDataFrames, assign `node_idx` and `edge_idx`, normalise list-valued tags by joining with ";", cast tag columns to nullable strings, and write `data/nodes.parquet` and `data/edges.parquet` following the contracts above.
   - Keep parallel edges between the same node pair. Do not dedupe here.
   - Write `data/build_info.json` containing the build timestamp (UTC ISO 8601), node count, edge count, and the OSMnx version.
4. Both scripts print a short summary (counts, total network length in km) and exit non-zero on failure.
5. `audit_physical.py` and `audit_tradeoff.py` are provided as reference implementations alongside this spec. Review them, fix any bug you find, run them after the ETL succeeds, and keep their output in `data/`.

Acceptance:

- `python build_graph.py && python build_edges.py` produces all three files from a clean checkout.
- Node and edge counts are plausible for a city of this size (tens of thousands of nodes and edges at minimum). Report the actual numbers.

## Folder: api/

Purpose: serve routes from the parquet files.

Requirements:

1. `requirements.txt`: fastapi, uvicorn, pandas, pyarrow, geopandas, shapely, numpy, scipy, pytest, httpx.
2. Structure: `main.py` (app and endpoints), `graph.py` (loading, indexing, routing), `profiles.py` (cost functions), `tests/`.
3. Startup: load `data/nodes.parquet`, `data/edges.parquet`, `data/build_info.json` once. Fail with a clear message if missing, pointing to the ETL commands.
4. Nearest node: build a `scipy.spatial.cKDTree` on node coordinates scaled for latitude (multiply longitude by cos of the mean latitude). Reject points further than 500 m from any node (`out_of_area`). Also reject points outside the Kraków bounding box of the graph, with a small margin.
5. Routing: for each profile, build a `scipy.sparse.csr_matrix` of edge costs, cached after first use. Parallel edges between the same node pair must be reduced to the minimum cost edge before building the matrix, because csr construction sums duplicates. Run `scipy.sparse.csgraph.dijkstra` from the start node with `return_predecessors=True`, then reconstruct the path.
6. Geometry: concatenate the geometries of the edges on the path in order, dropping the duplicated join points. Edge geometry is oriented from u to v.
7. `profiles.py`: a registry `PROFILES: dict[str, Callable[[pd.DataFrame], np.ndarray]]`. Each function receives the edges DataFrame and returns a per-edge cost multiplier (float, at least 1.0). Returning `np.inf` removes an edge (a hard exclusion). Cost is `length_m * multiplier`. Implement only `shortest` (all ones) now. Leave a docstring explaining how to add a profile.
8. `duration_min_estimate` assumes 5 km/h and is labelled an estimate in the field name.
9. CORS: allow `http://localhost:3000`, configurable by environment variable `ALLOWED_ORIGINS`.
10. `GET /health` returns node count, edge count and `data_built_at`.
11. Tests (pytest) using a tiny synthetic graph fixture, not the real data:
    - parallel edges are reduced to the cheapest one;
    - a route on a 4-node graph returns the expected path and length;
    - nearest-node rejection beyond 500 m;
    - no-route case returns 404 `no_route`;
    - an `inf` cost removes an edge.

Run command: `uvicorn main:app --reload --port 8000` from `api/`.

Acceptance:

- A request between two real points in Kraków returns a plausible route in under 2 seconds after warm-up. Report the measured time on the real graph, including the first request.
- All tests pass.

## Folder: web/

Purpose: map UI. Next.js (App Router), TypeScript in strict mode, MapLibre GL JS.

Requirements:

1. Create with `create-next-app`. Dependencies: `maplibre-gl` only, plus whatever Next installs. No UI framework required.
2. Environment variables (documented in `.env.example`): `NEXT_PUBLIC_API_URL` (default `http://localhost:8000`) and `NEXT_PUBLIC_MAP_STYLE_URL` (default: OpenFreeMap's public style; look up the current URL in their documentation instead of guessing).
3. Map: centred on Kraków (about 50.06, 19.94), zoom around 13. The attribution control must be visible and must show the OpenStreetMap credit, because the ODbL licence requires it. Do not hide or collapse it away entirely.
4. Interaction: first click sets the start marker, second click sets the end marker and requests a route. A "Reset" button clears everything. Markers can be dragged to re-request.
5. Rendering: draw the returned GeoJSON LineString as a line layer. Show the `summary` text in a panel. Fit the map to the route bounds.
6. States: idle, start-set, loading, route-ready, error. Show the API's `message` on error, in plain language.
7. Accessibility baseline:
    - the route summary is real text in the DOM, in an element with `aria-live="polite"`;
    - every control works by keyboard and has a visible focus style;
    - provide two text inputs (start and end as "lat, lon") with a "Get route" button as a non-map alternative;
    - do not use colour alone to distinguish start and end markers (use labels "A" and "B");
    - no autoplay or flashing; respect `prefers-reduced-motion` (disable animated `flyTo` and `fitBounds` animation);
    - sufficient contrast for the panel text.
8. Layout: works at phone width (about 380 px). On narrow screens the panel sits below or over the bottom of the map, and the map stays usable.
9. No localStorage use in this phase.
10. All API calls go through one small module (`lib/api.ts`) with typed responses matching the contract above.

Acceptance:

- With the API running, clicking two points draws a route and shows the summary.
- Works in Chrome desktop and a mobile viewport (browser dev tools is enough).
- `npm run build` and `npm run lint` pass.

## Root files

- `README.md`: what this is, prerequisites, and the exact commands to go from a clean checkout to a running app.
- `Makefile` targets: `setup` (create venvs and install dependencies), `data` (run the ETL), `api`, `web`, `audit` (run both audits), `test` (api tests).
- `.env.example` listing every variable used.

## Audits (run after the ETL)

Two scripts in `etl/`. They exist to help decide between a noise profile and a physical-accessibility profile.

1. `audit_physical.py`: reports what share of the walking network, by length, has each accessibility-relevant tag filled in, overall and by highway class. Also reports kilometres of steps and counts crossing nodes with and without a kerb tag. Writes `data/audit_physical.csv`.
2. `audit_tradeoff.py`: samples random origin and destination pairs 500 to 3000 m apart, routes each pair by shortest length and by a penalised cost, and reports the median extra distance and the median exposure reduction. Works with any per-edge `penalty` column (0 to 1). If none exists yet, it uses a crude road-class placeholder to test the pipeline. Placeholder output must not be reported as a finding. Writes `data/audit_tradeoff.csv`.

When the audits run, report the real numbers in the final message. Do not interpret them as a decision; just present them.

## Definition of done

From a clean checkout: `make setup && make data && make api` and `make web` in a second terminal gives a working map where two clicks produce a route. API tests pass. Both audits ran and their numbers are reported. Anything that could not be verified (for example the OpenFreeMap style URL, or the Nominatim polygon) is listed explicitly at the end.
