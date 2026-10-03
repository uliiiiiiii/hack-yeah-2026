# Walking-route planner for Kraków — developer entrypoints.
#
# Python 3.11+ and Node 20+ required. The web targets try to activate Node 20
# through nvm automatically; if you manage Node another way, just ensure
# `node --version` is >= 20 before running `make web`.

.PHONY: setup setup-etl setup-api setup-web data seed-crowds audit api api-lan web test clean mobile-apk mobile-open

PY := python3

# Activate Node 20 via nvm (if present) for the current recipe line.
define USE_NODE20
export NVM_DIR="$$HOME/.nvm"; \
[ -s "$$NVM_DIR/nvm.sh" ] && . "$$NVM_DIR/nvm.sh" && nvm use 20 >/dev/null 2>&1 || true;
endef

# Activate Node 22 (required by the Capacitor CLI) for mobile recipes.
define USE_NODE22
export NVM_DIR="$$HOME/.nvm"; \
[ -s "$$NVM_DIR/nvm.sh" ] && . "$$NVM_DIR/nvm.sh" && nvm use 22 >/dev/null 2>&1 || true; \
export ANDROID_HOME="$${ANDROID_HOME:-$$HOME/Android/Sdk}"; \
export ANDROID_SDK_ROOT="$${ANDROID_SDK_ROOT:-$$HOME/Android/Sdk}";
endef

## setup: create virtualenvs, install Python + web dependencies
setup: setup-etl setup-api setup-web
	@echo "Setup complete."

setup-etl:
	$(PY) -m venv etl/.venv
	etl/.venv/bin/pip install --upgrade pip
	etl/.venv/bin/pip install -r etl/requirements.txt

setup-api:
	$(PY) -m venv api/.venv
	api/.venv/bin/pip install --upgrade pip
	api/.venv/bin/pip install -r api/requirements.txt

setup-web:
	@$(USE_NODE20) cd web && npm install

## data: download the Kraków walking network and build the parquet files
data:
	cd etl && .venv/bin/python build_graph.py
	cd etl && .venv/bin/python build_edges.py
	cd etl && .venv/bin/python build_noise.py

## seed-crowds: seed Kraków venues into your BestTime account (needs the key in .env)
seed-crowds:
	cd etl && .venv/bin/python seed_besttime.py

## audit: run both audits (requires data/ to be built)
audit:
	cd etl && .venv/bin/python audit_physical.py
	cd etl && .venv/bin/python audit_tradeoff.py

## api: run the routing API on :8000
api:
	cd api && .venv/bin/uvicorn main:app --reload --port 8000

## web: run the Next.js dev server on :3000 (uses Node 20 via nvm if available)
web:
	@$(USE_NODE20) cd web && npm run dev

## api-lan: run the API bound to all interfaces so a phone on the LAN can reach it
api-lan:
	cd api && .venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000

## mobile-apk: static-export the web app, sync Capacitor, build a debug APK (Node 22)
mobile-apk:
	@$(USE_NODE22) cd web && npm run mobile:apk
	@echo "APK: web/android/app/build/outputs/apk/debug/app-debug.apk"

## mobile-open: open the Android project in Android Studio
mobile-open:
	@$(USE_NODE22) cd web && npm run mobile:open

## test: run the API test suite
test:
	cd api && .venv/bin/python -m pytest -q

## clean: remove generated data and build artifacts (keeps venvs)
clean:
	rm -f data/*.parquet data/*.json data/*.csv data/*.graphml
