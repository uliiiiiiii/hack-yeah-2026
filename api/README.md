---
title: Ciszej — Routing API
emoji: 🚶
colorFrom: green
colorTo: green
sdk: docker
app_port: 8000
pinned: false
---

# Ciszej — Routing API

FastAPI backend for the Kraków sensory-aware walking-route planner. It serves walking
routes over the OpenStreetMap graph, weighted by the things that matter to the user
(noise, crowds, light), and hosts user-submitted "quiet places".

## Endpoints

| Method | Path | What it does |
|---|---|---|
| GET | `/health` | Status, node/edge counts, available factors |
| GET | `/route?from=…&to=…&profile=…` | Walking route as GeoJSON (`shortest` or `sensory`) |
| GET | `/places?q=…` | Place-name search (Nominatim proxy) |
| GET | `/quiet-places` | List user-submitted quiet places |
| POST | `/quiet-places` | Add a quiet place |
| POST | `/quiet-places/{id}/vote` | Vote "accurate / not accurate" |
| POST | `/quiet-places/{id}/checkin` | "I'm here now" check-in |
| GET | `/calm-places?lat=…&lon=…` | Calm-place candidates for the overwhelm flow |

## Data

- The routing graph (159,239 nodes / 403,360 edges) and Kraków road-noise data are
  **baked into the image** — no ETL runs at deploy time.
- Quiet places live in SQLite (`places.db`), also baked in as a seed.

## Environment variables

| variable | purpose |
|---|---|
| `ALLOWED_ORIGINS` | CORS origins (default: localhost + Capacitor) |
| `BESTTIME_API_KEY_PRIVATE` | optional — enables the crowds factor |
| `VERIFY_TOKEN` | optional — enables the mark-Verified endpoint |
| `PLACES_DB` | optional — move the SQLite DB onto a persistent volume |

The web client is a separate Next.js static export (on Vercel), pointed at this service
via `NEXT_PUBLIC_API_URL`.
