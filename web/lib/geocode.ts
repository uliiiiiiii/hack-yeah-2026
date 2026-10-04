// Place-name search via OpenStreetMap Nominatim (free, no key). Biased to Kraków.
//
// Usage policy: ≤1 request/second and identify the app. We debounce in the UI and
// pass a descriptive query; browsers/Webviews set Referer automatically. Results
// are bounded to the Kraków viewbox so they line up with what the router covers.

import type { LatLon } from "./api";

export interface Place {
  label: string; // short, e.g. "Wawel Royal Castle"
  detail: string; // fuller context, e.g. "Okół, Kraków, Lesser Poland"
  lat: number;
  lon: number;
}

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
// left(lon), top(lat), right(lon), bottom(lat) around the Kraków agglomeration.
const KRAKOW_VIEWBOX = "19.79,50.16,20.25,49.95";

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

interface NominatimRow {
  display_name: string;
  name?: string;
  lat: string;
  lon: string;
}

function toPlace(row: NominatimRow): Place {
  const parts = row.display_name.split(",").map((s) => s.trim());
  const label = row.name && row.name.length > 0 ? row.name : parts[0];
  // Context: skip the first part if it equals the label; drop the trailing country.
  const rest = parts.filter((p) => p !== label);
  const detail = rest.slice(0, 3).join(", ");
  return { label, detail, lat: Number(row.lat), lon: Number(row.lon) };
}

// Search places by name. `signal` lets the caller cancel a superseded request.
export async function searchPlaces(
  query: string,
  language = "en",
  signal?: AbortSignal,
): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const params = new URLSearchParams({
    format: "json",
    q,
    limit: "6",
    addressdetails: "0",
    viewbox: KRAKOW_VIEWBOX,
    bounded: "1",
    "accept-language": language,
  });
  const res = await fetch(`${NOMINATIM}?${params.toString()}`, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Place search failed (${res.status}).`);
  const rows = (await res.json()) as NominatimRow[];
  return rows
    .map(toPlace)
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
}
