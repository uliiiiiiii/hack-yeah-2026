// Quiet places (user-submitted, §2O/§2P): types + fetch helpers, mirroring
// lib/api.ts. All calls go to the FastAPI backend; declared data is always
// "Reported by a person / Not verified / Estimated", votes are opinions.
import { API_URL } from "./api";

export type EntryCondition = "open_to_anyone" | "customers_only" | "ask_staff";
export type TrustTier = "reported" | "confirmed" | "disputed";

export interface QuietHourWindow {
  day: number; // 0=Mon..6=Sun
  start: string; // "HH:MM"
  end: string; // "HH:MM"
}

export interface Place {
  id: number;
  name: string;
  type: string;
  lat: number;
  lon: number;
  entry_condition: EntryCondition;
  quiet_hours: QuietHourWindow[];
  posted_at: string;
  verified: boolean;
  verified_at: string | null;
  verified_note: string | null;
  trust: TrustTier;
  disputed: boolean;
  vote_counts: { accurate: number; not_accurate: number };
  checkin_counts: { yes: number; no: number; total: number };
  active_now: boolean;
  next_window: string | null;
}

export interface CalmPlace extends Place {
  distance_m: number;
  walk_min: number;
}

export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const ENTRY_CONDITION_LABEL: Record<EntryCondition, string> = {
  open_to_anyone: "Open to anyone",
  customers_only: "Customers only",
  ask_staff: "Ask staff",
};

export class PlaceRequestError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PlaceRequestError";
    this.code = code;
  }
}

// One anonymous id per device (ACC-03/ACC-14): votes and check-ins are deduped
// against it. Not user-identifying; stored like the settings key.
const DEVICE_KEY = "krk.device";
export function getDeviceId(): string {
  if (typeof window === "undefined") return "server";
  try {
    let id = window.localStorage.getItem(DEVICE_KEY);
    if (!id) {
      const rand = window.crypto?.randomUUID?.() ??
        `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      id = rand;
      window.localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "dev-anon";
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new PlaceRequestError(
      "network",
      "Could not reach the places service. Is the API running on " + API_URL + "?",
    );
  }
  if (!res.ok) {
    let e: { error?: string; message?: string } = {};
    try {
      e = (await res.json()) as { error?: string; message?: string };
    } catch {
      /* non-JSON error body */
    }
    throw new PlaceRequestError(
      e.error ?? "error",
      e.message ?? `Request failed (${res.status}).`,
    );
  }
  return (await res.json()) as T;
}

async function getJson<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`);
  } catch {
    throw new PlaceRequestError(
      "network",
      "Could not reach the places service. Is the API running on " + API_URL + "?",
    );
  }
  if (!res.ok) {
    let e: { error?: string; message?: string } = {};
    try {
      e = (await res.json()) as { error?: string; message?: string };
    } catch {
      /* non-JSON error body */
    }
    throw new PlaceRequestError(
      e.error ?? "error",
      e.message ?? `Request failed (${res.status}).`,
    );
  }
  return (await res.json()) as T;
}

export async function listPlaces(
  bbox?: [number, number, number, number],
): Promise<Place[]> {
  const q = bbox ? `?bbox=${bbox.join(",")}` : "";
  const body = await getJson<{ places: Place[] }>(`/quiet-places${q}`);
  return body.places;
}

export async function getPlace(id: number): Promise<Place> {
  return getJson<Place>(`/quiet-places/${id}`);
}

export interface NewPlace {
  name: string;
  type: string;
  lat: number;
  lon: number;
  entry_condition: EntryCondition;
  quiet_hours: QuietHourWindow[];
}

export async function createPlace(input: NewPlace): Promise<Place> {
  return postJson<Place>("/quiet-places", {
    ...input,
    device_id: getDeviceId(),
  });
}

export async function votePlace(
  id: number,
  value: "accurate" | "not_accurate",
): Promise<Place> {
  return postJson<Place>(`/quiet-places/${id}/vote`, {
    device_id: getDeviceId(),
    value,
  });
}

export async function checkinPlace(
  id: number,
  value: "yes" | "no" | "not_sure" | null,
): Promise<Place> {
  return postJson<Place>(`/quiet-places/${id}/checkin`, {
    device_id: getDeviceId(),
    value,
  });
}

export async function searchCalmPlaces(
  lat: number,
  lon: number,
): Promise<CalmPlace[]> {
  const body = await getJson<{ places: CalmPlace[] }>(
    `/calm-places?lat=${lat}&lon=${lon}`,
  );
  return body.places;
}

// The device's own vote, kept on-device so the buttons show their pressed state
// across sessions (ACC-02). The server still dedupes as a backstop (ACC-03).
const VOTES_KEY = "krk.votes";
function loadMyVotes(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(VOTES_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export function myVote(placeId: number): "accurate" | "not_accurate" | null {
  const v = loadMyVotes()[String(placeId)];
  return v === "accurate" || v === "not_accurate" ? v : null;
}

export function setMyVote(
  placeId: number,
  value: "accurate" | "not_accurate" | null,
): void {
  if (typeof window === "undefined") return;
  const votes = loadMyVotes();
  if (value === null) delete votes[String(placeId)];
  else votes[String(placeId)] = value;
  try {
    window.localStorage.setItem(VOTES_KEY, JSON.stringify(votes));
  } catch {
    /* storage blocked */
  }
}
