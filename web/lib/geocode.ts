// Place-name search, proxied through our own API (see api/places.py).
//
// The browser deliberately does NOT call Nominatim directly:
//
//   * Its usage policy forbids building auto-complete search on the client side
//     over the public API, so this is called on an explicit submit (Enter or the
//     Find button) — never on every keystroke.
//   * The policy asks apps to set up a proxy with caching, capped at one request
//     per second in total. api/places.py does exactly that.
//   * Our page is statically exported and runs inside a Capacitor WebView
//     (https://localhost), which cannot send the identifying Referer the policy
//     requires. The proxy sets the User-Agent instead.
//
// Data © OpenStreetMap contributors (ODbL): the attribution the API returns is
// displayed next to the suggestions.

import { API_URL } from "./api";
import type { LatLon } from "./api";

export interface Place {
  label: string; // short, e.g. "Wawel"
  detail: string; // fuller context, e.g. "Stare Miasto, Kraków"
  lat: number;
  lon: number;
}

export interface PlaceSearchResponse {
  query: string;
  source: string;
  attribution: string;
  results: Place[];
}

// Try to read a "lat, lon" pair out of free text so coordinate entry still works.
export function parseCoords(text: string): LatLon | null {
  const m = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

export class PlaceSearchError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PlaceSearchError";
    this.code = code;
  }
}

const EMPTY: PlaceSearchResponse = { query: "", source: "", attribution: "", results: [] };

// Upper bound on one lookup, including the proxy's own 1 req/s queue and its 10s
// upstream timeout, so a healthy search never trips this. It exists because a
// fetch to an unreachable host can hang for minutes: without it the field stays
// "Searching…" forever and, since that notice was screen-reader-only, the user
// just sees a box that does nothing (MOT-03).
const PLACE_SEARCH_TIMEOUT_MS = 15_000;

// Search places by name. `signal` lets the caller cancel a superseded request.
export async function searchPlaces(
  query: string,
  language = "en",
  signal?: AbortSignal,
): Promise<PlaceSearchResponse> {
  const q = query.trim();
  if (q.length < 2) return { ...EMPTY, query: q };

  const params = new URLSearchParams({ q, lang: language });

  // Drive the fetch from our own controller so a timeout and a caller
  // cancellation stay distinguishable — the caller aborting means "the user kept
  // typing" and must stay silent, a timeout means "the service is not answering".
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, PLACE_SEARCH_TIMEOUT_MS);
  const forwardAbort = () => ctrl.abort();
  signal?.addEventListener("abort", forwardAbort);

  let res: Response;
  try {
    try {
      res = await fetch(`${API_URL}/places?${params.toString()}`, { signal: ctrl.signal });
    } catch {
      if (timedOut) {
        throw new PlaceSearchError(
          "timeout",
          "Place search is taking too long. Is the API running on " + API_URL + "?",
        );
      }
      // A superseded request is not a failure: re-throw so the caller's
      // AbortError guard swallows it and no error is shown.
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      throw new PlaceSearchError(
        "network",
        "Could not reach the place search service. Is the API running on " + API_URL + "?",
      );
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forwardAbort);
  }

  if (!res.ok) {
    let body: { error?: string; message?: string } = {};
    try {
      body = (await res.json()) as { error?: string; message?: string };
    } catch {
      /* non-JSON error body */
    }
    throw new PlaceSearchError(
      body.error ?? "error",
      body.message ?? `Place search failed (status ${res.status}).`,
    );
  }
  return (await res.json()) as PlaceSearchResponse;
}

