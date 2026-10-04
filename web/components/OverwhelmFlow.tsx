"use client";

// "I don't feel well" → get to a calm place (F13, §2N).
//
// Now backed by the user-submitted quiet places: we search for a place whose
// quiet hours are active right now and that is not disputed, and offer the
// nearest one — labelled honestly as "Reported by a person · Not verified ·
// Estimated", never "Known" (OVW-06, BIZ-05). If nothing qualifies (or there is
// no location), we say so plainly and always offer Stay here and Call 112.
//
// The screen is calm by construction: muted, no animation, Back and Call 112
// always visible, one decision at a time (OVW-02, OVW-03, OVW-08, OVW-09).
import { useEffect, useRef, useState } from "react";
import { PhoneIcon } from "./icons";
import {
  ENTRY_CONDITION_LABEL,
  searchCalmPlaces,
  type CalmPlace,
} from "@/lib/places";
import styles from "./overwhelm.module.css";

type View = "searching" | "none" | "stay" | "place";

export default function OverwhelmFlow({
  open,
  onClose,
  savedContact,
  onGoThere,
}: {
  open: boolean;
  onClose: () => void;
  savedContact: string;
  onGoThere: (place: CalmPlace) => void;
}) {
  const [view, setView] = useState<View>("searching");
  const [slow, setSlow] = useState(false);
  const [noLocation, setNoLocation] = useState(false);
  const [places, setPlaces] = useState<CalmPlace[]>([]);
  const [placeIndex, setPlaceIndex] = useState(0);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  // Reset and search each time the flow opens (external-driven reset).
  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setView("searching");
    setSlow(false);
    setNoLocation(false);
    setPlaces([]);
    setPlaceIndex(0);
    /* eslint-enable react-hooks/set-state-in-effect */

    const t1 = window.setTimeout(() => setSlow(true), 3000); // "Still looking" (F13.2)
    let cancelled = false;

    if (!navigator.geolocation) {
      setNoLocation(true);
      setView("none");
      return () => window.clearTimeout(t1);
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        searchCalmPlaces(pos.coords.latitude, pos.coords.longitude)
          .then((found) => {
            if (cancelled) return;
            if (found.length > 0) {
              setPlaces(found);
              setPlaceIndex(0);
              setView("place");
            } else {
              setView("none");
            }
          })
          .catch(() => {
            if (!cancelled) setView("none");
          });
      },
      () => {
        if (!cancelled) {
          setNoLocation(true);
          setView("none");
        }
      },
    );
    return () => {
      cancelled = true;
      window.clearTimeout(t1);
    };
  }, [open]);

  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open, view]);

  if (!open) return null;

  const place = places[placeIndex];

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

        {view === "place" && place && (
          <>
            <h1 id="calm-heading" className={styles.heading} tabIndex={-1} ref={headingRef}>
              {place.name}
            </h1>
            <p className={styles.line}>
              {place.type ? `${place.type} · ` : ""}about {place.walk_min} min walk
            </p>
            <p className={styles.line}>
              Reported by a person · Not verified · Estimated. {ENTRY_CONDITION_LABEL[place.entry_condition]}.
            </p>
            <div className={styles.choices}>
              <button type="button" className={styles.choicePrimary} onClick={() => onGoThere(place)}>
                Go there
              </button>
              {places.length > 1 && (
                <button
                  type="button"
                  className={styles.choice}
                  onClick={() => setPlaceIndex((i) => (i + 1) % places.length)}
                >
                  Show another place
                </button>
              )}
              <button type="button" className={styles.choice} onClick={() => setView("stay")}>
                Stay here
              </button>
              {savedContact && (
                <a className={styles.choice} href={`tel:${savedContact}`}>
                  Call someone
                </a>
              )}
            </div>
          </>
        )}

        {view === "none" && (
          <>
            <h1 id="calm-heading" className={styles.heading} tabIndex={-1} ref={headingRef}>
              {noLocation ? "We can't find your location" : "We don't know of a calm place nearby"}
            </h1>
            <p className={styles.line}>
              {noLocation
                ? "We can't search without your location. You can stay where you are, or call someone."
                : "No place with quiet hours right now. We won't guess. You can stay where you are, or call someone."}
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
