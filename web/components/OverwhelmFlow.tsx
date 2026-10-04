"use client";

// "I don't feel well" → get to a calm place (F13, §2N).
//
// Honesty note (OVW-06): a calm place must have Known/Estimated data for the
// relevant factors. We do not yet have a vetted calm-place dataset (open item in
// the spec, §7), so rather than invent one we tell the truth — "We don't know of
// a calm place nearby" — and always offer Stay here and Call 112. Faking a
// suggestion at a vulnerable moment is exactly what UNC-01/OVW-06 forbid.
//
// The screen is calm by construction: muted, no animation, Back and Call 112
// always visible, one decision at a time (OVW-02, OVW-03, OVW-08, OVW-09).
import { useEffect, useRef, useState } from "react";
import { PhoneIcon } from "./icons";
import styles from "./overwhelm.module.css";

type View = "searching" | "none" | "stay";

export default function OverwhelmFlow({
  open,
  onClose,
  savedContact,
}: {
  open: boolean;
  onClose: () => void;
  savedContact: string;
}) {
  const [view, setView] = useState<View>("searching");
  const [slow, setSlow] = useState(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  // Reset to the searching state each time the flow opens (sync to the `open`
  // prop coming from the parent — a legitimate external-driven reset).
  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setView("searching");
    setSlow(false);
    /* eslint-enable react-hooks/set-state-in-effect */
    const t1 = window.setTimeout(() => setSlow(true), 3000); // "Still looking" (OVW F13.2)
    // No dataset to search; resolve honestly to "none" shortly after.
    const t2 = window.setTimeout(() => setView("none"), 1200);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [open]);

  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open, view]);

  if (!open) return null;

  return (
    <div
      className={styles.screen}
      role="dialog"
      aria-modal="true"
      aria-labelledby="calm-heading"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className={styles.top}>
        <button type="button" className={styles.back} onClick={onClose}>
          Back
        </button>
        <a className={styles.call112} href="tel:112">
          <PhoneIcon />
          Call 112
        </a>
      </div>

      <div className={styles.body}>
        {view === "searching" && (
          <>
            <h1 id="calm-heading" className={styles.heading} tabIndex={-1} ref={headingRef}>
              Finding a calm place near you
            </h1>
            <p className={styles.line} aria-live="polite">
              {slow ? "Still looking." : "One moment."}
            </p>
          </>
        )}

        {view === "none" && (
          <>
            <h1 id="calm-heading" className={styles.heading} tabIndex={-1} ref={headingRef}>
              We don&apos;t know of a calm place nearby
            </h1>
            <p className={styles.line}>
              We don&apos;t have calm-place data for this area yet, so we won&apos;t guess. You can stay where you
              are, or call someone.
            </p>
            <div className={styles.choices}>
              <button type="button" className={styles.choicePrimary} onClick={() => setView("stay")}>
                Stay here
              </button>
              {savedContact && (
                <a className={styles.choice} href={`tel:${savedContact}`}>
                  Call someone
                </a>
              )}
              <button type="button" className={styles.choice} onClick={onClose}>
                Back to map
              </button>
            </div>
          </>
        )}

        {view === "stay" && (
          <>
            <h1 id="calm-heading" className={styles.heading} tabIndex={-1} ref={headingRef}>
              Take your time
            </h1>
            <p className={styles.line}>Nothing needs doing.</p>
            <div className={styles.choices}>
              <button type="button" className={styles.choicePrimary} onClick={() => setView("searching")}>
                Find a calm place
              </button>
              {savedContact && (
                <a className={styles.choice} href={`tel:${savedContact}`}>
                  Call someone
                </a>
              )}
              <button type="button" className={styles.choice} onClick={onClose}>
                Back to map
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
