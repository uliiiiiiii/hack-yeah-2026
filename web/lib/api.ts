// Single place all API calls go through. Types mirror the API contract exactly.

export interface LatLon {
  lat: number;
  lon: number;
}

export interface RouteProperties {
  profile: string;
  length_m: number;
  duration_min_estimate: number;
  edge_count: number;
  summary: string;
  data_built_at: string;
}

export interface RouteFeature {
  type: "Feature";
  geometry: {
    type: "LineString";
    coordinates: [number, number][]; // [lon, lat]
  };
  properties: RouteProperties;
}

export interface ApiError {
  error: string;
  message: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** Thrown for any non-2xx response; carries the API's human-readable message. */
export class RouteRequestError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "RouteRequestError";
    this.code = code;
  }
}

export async function getRoute(
  from: LatLon,
  to: LatLon,
  profile = "shortest",
): Promise<RouteFeature> {
  const params = new URLSearchParams({
    from: `${from.lat},${from.lon}`,
    to: `${to.lat},${to.lon}`,
    profile,
  });

  let res: Response;
  try {
    res = await fetch(`${API_URL}/route?${params.toString()}`);
  } catch {
    throw new RouteRequestError(
      "network",
      "Could not reach the routing service. Is the API running on " + API_URL + "?",
    );
  }

  if (!res.ok) {
    let body: Partial<ApiError> = {};
    try {
      body = (await res.json()) as ApiError;
    } catch {
      /* non-JSON error body */
    }
    throw new RouteRequestError(
      body.error ?? "error",
      body.message ?? `Request failed with status ${res.status}.`,
    );
  }

  return (await res.json()) as RouteFeature;
}
