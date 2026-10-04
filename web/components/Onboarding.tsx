"use client";

// First-run setup (F1): ask, calmly and once, which things bother the user, then
// save them as the default profile for every trip. Nothing here is required —
// closing or "Skip for now" still marks setup done, so the question is never
// asked twice (PER-01, P4: nothing changes unless asked).
import { useEffect, useState } from "react";
import Sheet from "./Sheet";
import { CheckIcon } from "./icons";
import type { LightMode } from "@/lib/api";
import styles from "@/app/page.module.css";
import c from "./content.module.css";

export interface OnboardProfile {
  noise: boolean;
  light: LightMode | null;
  crowd: boolean;
}

export default function Onboarding({
  open,
  availCrowd,
  onSkip,
  onSave,
}: {
  open: boolean;
  availCrowd: boolean;
  // Skip: setup is done, profile left at its default.
  onSkip: () => void;
  // Save: setup is done and this profile becomes the default for new trips.
  onSave: (p: OnboardProfile) => void;
}) {
  const [noise, setNoise] = useState(false);
  const [light, setLight] = useState<LightMode | null>(null);
  const [crowd, setCrowd] = useState(false);

  // Start from a clean slate each time the flow opens (external-driven reset).
  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setNoise(false);
    setLight(null);
    setCrowd(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open]);

  return (
    <Sheet open={open} onClose={onSkip} title="What bothers you?" labelId="onboard-title">
      <p className={c.groupNote}>
        Pick the things you&apos;d like your routes to avoid. We&apos;ll use these every time — you can change
        them for a single trip, or in Settings, whenever you like.
      </p>

      <div className={styles.profileRow}>
        <button
          type="button"
          className={styles.toggle}
          aria-pressed={noise}
          onClick={() => setNoise((v) => !v)}
        >
          {noise && <CheckIcon className={styles.check} />}
          Loud noise
        </button>

        {availCrowd && (
          <button
            type="button"
            className={styles.toggle}
            aria-pressed={crowd}
            onClick={() => setCrowd((v) => !v)}
          >
            {crowd && <CheckIcon className={styles.check} />}
            Crowds
          </button>
        )}
      </div>

      <p className={c.rowLabel} style={{ marginBottom: "0.4rem" }}>Light</p>
      <span className={styles.segmented} role="radiogroup" aria-label="Light preference">
        <button
          type="button"
          aria-pressed={light === "avoid_bright"}
          onClick={() => setLight((v) => (v === "avoid_bright" ? null : "avoid_bright"))}
        >
          Avoid bright
        </button>
        <button type="button" aria-pressed={light === null} onClick={() => setLight(null)}>
          No preference
        </button>
        <button
          type="button"
          aria-pressed={light === "prefer_lit"}
          onClick={() => setLight((v) => (v === "prefer_lit" ? null : "prefer_lit"))}
        >
          Prefer well-lit
        </button>
      </span>

      <div className={c.actions} style={{ marginTop: "1.2rem" }}>
        <button
          type="button"
          className={styles.primary}
          style={{ marginTop: 0 }}
          onClick={() => onSave({ noise, light, crowd })}
        >
          Save and start
        </button>
        <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onSkip}>
          Skip for now
        </button>
      </div>
    </Sheet>
  );
}
