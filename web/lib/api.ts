// Single place all API calls go through. Types mirror the API contract exactly.

export interface LatLon {
  lat: number;
  lon: number;
}

export type LightMode = "avoid_bright" | "prefer_lit";
export type Strength = "low" | "medium" | "high";

export interface RouteOptions {
  noise?: boolean;
  light?: LightMode | null;
  strength?: Strength;
}

export interface NoiseExposure {
  mean_lden_db: number | null;
  loud_pct: number;
}
export interface LightExposure {
  lit_pct: number;
  unlit_pct: number;
}
export interface FactorUncertainty {
  unknown_pct: number;
  unknown_m: number;
}

export interface RouteProperties {
  profile: string;
  factors: {
    profile: string;
    noise?: boolean;
    light?: LightMode | null;
    strength?: Strength;
  };
  length_m: number;
  duration_min_estimate: number;
  edge_count: number;
  summary: string;
  exposure: { noise?: NoiseExposure; light?: LightExposure };
  uncertainty: { noise?: FactorUncertainty; light?: FactorUncertainty };
  data_built_at: string;
}

export interface RouteFeature {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: [number, number][] };
  properties: RouteProperties;
  // Sub-paths (each a list of [lon,lat]) where a selected factor's data is unknown.
  uncertain_segments: [number, number][][];
}

export interface HealthInfo {
  status: string;
  node_count: number;
  edge_count: number;
  data_built_at: string;
  profiles: string[];
  factors: { noise: boolean; light: boolean };
}

export interface ApiError {
  error: string;
  message: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class RouteRequestError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "RouteRequestError";
    this.code = code;
  }
}

export async function getHealth(): Promise<HealthInfo> {
  const res = await fetch(`${API_URL}/health`);
  if (!res.ok) throw new RouteRequestError("health", `Health check failed (${res.status}).`);
  return (await res.json()) as HealthInfo;
}

export async function getRoute(
  from: LatLon,
  to: LatLon,
  opts: RouteOptions = {},
): Promise<RouteFeature> {
  const active = opts.noise || (opts.light ?? null);
  const params = new URLSearchParams({
    from: `${from.lat},${from.lon}`,
    to: `${to.lat},${to.lon}`,
    profile: active ? "sensory" : "shortest",
  });
  if (active) {
    if (opts.noise) params.set("noise", "on");
    if (opts.light) params.set("light", opts.light);
    params.set("strength", opts.strength ?? "medium");
  }

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
