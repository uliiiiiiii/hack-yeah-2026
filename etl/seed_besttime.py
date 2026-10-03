"""Seed your BestTime account with Kraków venues so the API can query their
current foot traffic (the "busy areas" factor).

Run ONCE (it costs BestTime credits). It submits area searches to BestTime, which
then builds foot-traffic forecasts for the found venues in the background. After
it finishes (minutes), the API's /venues/filter queries will return these venues.

    # put your key in the repo-root .env first:  BESTTIME_API_KEY_PRIVATE=...
    python etl/seed_besttime.py
    python etl/seed_besttime.py --num 40   # venues per query (20-60)

Docs: https://documentation.besttime.app/  (Venues Search endpoint)
"""
import argparse
import os
import sys
from pathlib import Path

import requests

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except Exception:
    pass

SEARCH_URL = "https://besttime.app/api/v1/venues/search"

# Venue-type queries that cover the usual "busy" places in Kraków.
QUERIES = [
    "restaurants in Kraków, Poland",
    "bars and pubs in Kraków, Poland",
    "cafes in Kraków, Poland",
    "shopping in Kraków, Poland",
    "tourist attractions in Kraków, Poland",
    "nightclubs in Kraków, Poland",
    "supermarkets in Kraków, Poland",
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--num", type=int, default=30, help="venues per query (20-60)")
    args = ap.parse_args()

    key = os.environ.get("BESTTIME_API_KEY_PRIVATE")
    if not key:
        print("ERROR: BESTTIME_API_KEY_PRIVATE is not set. Add it to the repo-root "
              ".env (see .env.example) or export it.", file=sys.stderr)
        return 1

    print(f"Seeding {len(QUERIES)} venue searches for Kraków "
          f"({args.num} venues each)…\n")
    ok = 0
    for q in QUERIES:
        try:
            r = requests.post(SEARCH_URL, params={
                "api_key_private": key, "q": q, "num": max(20, min(args.num, 60)),
            }, timeout=60)
            r.raise_for_status()
            d = r.json()
            print(f"  '{q}': job_id={d.get('job_id')} collection_id={d.get('collection_id')} "
                  f"status={d.get('status', 'submitted')}")
            ok += 1
        except Exception as exc:
            print(f"  '{q}': FAILED — {exc}", file=sys.stderr)

    print(f"\nSubmitted {ok}/{len(QUERIES)} searches. BestTime processes them in the "
          "background (minutes). Once done, start the API and the 'busy areas' factor "
          "will use this data. Check /health -> crowd_status.venue_count.")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
