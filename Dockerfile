# Kraków walking-route API, with the routing data baked into the image.
#
# The ETL output (nodes/edges/edge_sensory parquet + build_info.json) is
# read-only and ~30 MB, so it is COPY-ed in so the image runs with no ETL step.
# The mutable SQLite DB (places.db) is also baked as a seed; point PLACES_DB at a
# persistent volume to survive redeploys (see README "Deployment").
#
# Build from the repo root:
#   docker build -t krakow-routes-api .
# Run:
#   docker run --rm -p 8000:8000 krakow-routes-api
FROM python:3.12-slim

WORKDIR /app

# Install Python deps first so this layer is cached across source changes.
COPY api/requirements.txt ./api/requirements.txt
RUN pip install --no-cache-dir -r api/requirements.txt

# API source + the prebuilt routing data (baked in; see .dockerignore).
COPY api ./api
COPY data ./data

# Read-only routing data lives here. Set PLACES_DB to move the mutable
# places.db onto a persistent volume if you need votes/check-ins to survive.
ENV DATA_DIR=/app/data

WORKDIR /app/api
EXPOSE 8000
# Render injects PORT; local docker run defaults to 8000.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
