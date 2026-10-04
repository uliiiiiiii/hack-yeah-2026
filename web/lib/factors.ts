// Factor vocabulary and the data-confidence model (design-requirements §2E, 2F).
//
// Three data states per factor (UNC-01): Known, Estimated, No data.
//   - Noise  : Kraków 2022 acoustic map — Known where measured, else No data.
//   - Light  : OSM `lit` tag — Known where tagged, else No data.
//   - Crowds : BestTime forecast — a typical pattern, so always Estimated (the
//              "~" and "typical" wording, UNC-07), No data where no venue is near.
//
// Vocabulary is deliberately distinct per factor (FAC-09) and never says "safe".

import type {
  LightMode,
  RouteProperties,
} from "./api";

export type FactorKey = "noise" | "light" | "crowd";
export type DataState = "known" | "estimated" | "no-data";

export interface FactorView {
  key: FactorKey;
  label: string; // "Noise", "Light", "Crowds"
  levelWord: string | null; // "Quiet" / "Bright" / "Few people"; null when no data at all
  estimated: boolean; // true -> prefix "~" and note "typical"
  knownPct: number; // 0..100 of the route that has data for this factor
  noDataPct: number; // 0..100 with no data
  // One honest sentence for cards and the segment list (CNT-01, UNC-03/04).
  text: string;
  // Screen-reader sentence, e.g. "Noise: quiet, data for 100 percent of the route".
  speech: string;
}

const NOISE_WORDS = ["Quiet", "Moderate", "Loud"] as const;
const LIGHT_WORDS = ["Dim", "Moderate", "Bright"] as const;
const CROWD_WORDS = ["Few people", "Some people", "Many people"] as const;

function round(n: number): number {
  return Math.round(n);
}

function noiseLevel(meanDb: number | null, loudPct: number): string | null {
  if (meanDb == null) {
    // Fall back to loud share if the mean is missing but we have coverage.
    if (loudPct >= 25) return NOISE_WORDS[2];
    return null;
  }
  if (meanDb < 55) return NOISE_WORDS[0];
  if (meanDb < 68) return NOISE_WORDS[1];
  return NOISE_WORDS[2];
}

function lightLevel(litPct: number, unlitPct: number): string | null {
  const known = litPct + unlitPct;
  if (known <= 0) return null;
  const litShare = (litPct / known) * 100;
  if (litShare >= 66) return LIGHT_WORDS[2];
  if (litShare >= 33) return LIGHT_WORDS[1];
  return LIGHT_WORDS[0];
}

function crowdLevel(busyPct: number): string {
  if (busyPct < 15) return CROWD_WORDS[0];
  if (busyPct < 50) return CROWD_WORDS[1];
  return CROWD_WORDS[2];
}

// "typical for now" / "typical for Sat 18:00" (UNC-07). timeLabel is caller-supplied.
export function buildFactorViews(
  props: RouteProperties,
  active: { noise: boolean; light: LightMode | null; crowd: boolean },
  timeLabel: string,
): FactorView[] {
  const views: FactorView[] = [];
  const exp = props.exposure ?? {};
  const unc = props.uncertainty ?? {};

  if (active.noise && exp.noise) {
    const noDataPct = round(unc.noise?.unknown_pct ?? 0);
    const knownPct = 100 - noDataPct;
    const word = noiseLevel(exp.noise.mean_lden_db, exp.noise.loud_pct);
    views.push({
      key: "noise",
      label: "Noise",
      levelWord: word,
      estimated: false,
      knownPct,
      noDataPct,
      text: word
        ? `${word}${noDataPct > 0 ? `, no data on ${noDataPct}%` : `, ${knownPct}% known`}`
        : "No data yet",
      speech: word
        ? `Noise: ${word.toLowerCase()}, data for ${knownPct} percent of the route`
        : "Noise: no data",
    });
  }

  if (active.light && exp.light) {
    const noDataPct = round(unc.light?.unknown_pct ?? 0);
    const knownPct = 100 - noDataPct;
    const word = lightLevel(exp.light.lit_pct, exp.light.unlit_pct);
    views.push({
      key: "light",
      label: "Light",
      levelWord: word,
      estimated: false,
      knownPct,
      noDataPct,
      text: word
        ? `${word}${noDataPct > 0 ? `, no data on ${noDataPct}%` : `, ${knownPct}% known`}`
        : "No data yet",
      speech: word
        ? `Light: ${word.toLowerCase()}, data for ${knownPct} percent of the route`
        : "Light: no data",
    });
  }

  if (active.crowd && exp.crowd) {
    const noDataPct = round(unc.crowd?.unknown_pct ?? 0);
    const knownPct = 100 - noDataPct;
    // Never claim a level when nothing is known for the chosen time (UNC-01).
    const word = knownPct > 0 ? crowdLevel(exp.crowd.busy_pct) : null;
    // Crowds are a forecast — always Estimated: "~" prefix + the time label.
    views.push({
      key: "crowd",
      label: "Crowds",
      levelWord: word,
      estimated: true,
      knownPct,
      noDataPct,
      text: word
        ? `~${word}, ${timeLabel}${noDataPct > 0 ? `, no data on ${noDataPct}%` : ""}`
        : "No data yet",
      speech: word
        ? `Crowds: about ${word.toLowerCase()}, ${timeLabel}, data for ${knownPct} percent of the route`
        : "Crowds: no data",
    });
  }

  return views;
}

// Name a route by the factors the user picked (FAC-06, CNT-03 — never "safe"/"best").
export function routeName(active: {
  noise: boolean;
  light: LightMode | null;
  crowd: boolean;
}): string {
  const picked: string[] = [];
  if (active.noise) picked.push("quiet");
  if (active.light === "prefer_lit") picked.push("lit");
  if (active.light === "avoid_bright") picked.push("dim");
  if (active.crowd) picked.push("calm");
  if (picked.length === 0) return "Shortest";
  if (picked.length > 1) return "Best match for you";
  switch (picked[0]) {
    case "quiet":
      return "Quietest";
    case "lit":
      return "Best-lit";
    case "dim":
      return "Least bright";
    case "calm":
      return "Fewest people";
    default:
      return "Best match for you";
  }
}
