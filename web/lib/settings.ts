// User settings: display, routing, alerts, language. Persisted on-device only
// (PRV-01/PRV-02 — nothing leaves the device). Applied live with no flash.

import type { LightMode } from "./api";

export type Theme = "light" | "dark" | "system";
export type TextSize = "normal" | "large" | "xlarge" | "xxlarge";
export type Language = "en" | "pl" | "uk";
export type Strictness = "flexible" | "strict";
export type MaxExtra = 5 | 10 | 20 | null; // minutes; null = no limit

export interface Settings {
  // Display
  theme: Theme;
  textSize: TextSize;
  lowStim: boolean;
  reduceMotion: boolean;
  // Routing defaults
  strictness: Strictness;
  maxExtra: MaxExtra;
  preferMoreData: boolean; // UNC-05: when scores are close, prefer known data
  // Alerts
  haptics: boolean;
  sound: boolean;
  inWalkCues: boolean;
  // Default profile applied to new trips ("Save as my default", F6).
  profile: { noise: boolean; light: LightMode | null; crowd: boolean };
  // Other
  language: Language;
  savedContact: string; // phone number for "Call someone" (OVW-11); empty = unset
  onboarded: boolean; // first-run setup (F1) completed or skipped
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  textSize: "normal",
  lowStim: false,
  reduceMotion: false,
  strictness: "flexible",
  maxExtra: 10, // [DATA] default maximum extra time
  preferMoreData: true,
  haptics: false,
  sound: false,
  inWalkCues: true,
  profile: { noise: false, light: null, crowd: false },
  language: "en",
  savedContact: "",
  onboarded: false,
};

const KEY = "krk.settings";

export function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage blocked — settings still apply for this session */
  }
}

// Reflect settings onto <html> so CSS tokens, text size and motion update live.
export function applySettings(s: Settings): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", s.theme);
  root.setAttribute("data-text-size", s.textSize);
  root.setAttribute("lang", s.language);
  if (s.reduceMotion) root.setAttribute("data-reduce-motion", "on");
  else root.removeAttribute("data-reduce-motion");
  if (s.lowStim) root.setAttribute("data-low-stim", "on");
  else root.removeAttribute("data-low-stim");
}

// True when motion should be suppressed (user setting or OS preference).
export function motionReduced(s: Settings): boolean {
  if (s.reduceMotion || s.lowStim) return true;
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
