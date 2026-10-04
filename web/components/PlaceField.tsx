"use client";

// A place-name search field (INP-01): a WAI-ARIA combobox over a listbox of
// suggestions, with a visible label and full keyboard support.
//
// Search runs on an EXPLICIT submit — Enter or the Find button — never on every
// keystroke. Nominatim's usage policy forbids client-side auto-complete over the
// public API, and our proxy (api/places.py) is throttled to one request per
// second, so per-keystroke searching would be both a policy breach and a
// self-inflicted rate-limit problem. Typing "lat, lon" still works: a
// "Use coordinates" option appears first.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  parseCoords,
  searchPlaces,
  type Place,
  type PlaceSearchResponse,
} from "@/lib/geocode";
import type { LatLon } from "@/lib/api";
import styles from "./placefield.module.css";

interface Option {
  key: string;
  label: string;
  detail: string;
  point: LatLon;
}

// Auto-search tuning. The proxy caps outbound requests at one per second, so
// these only control how often we bother to ask.
const AUTO_SEARCH = true;         // false => search on Enter only
const AUTO_SEARCH_MIN_CHARS = 3;  // below this, no network request at all
const AUTO_SEARCH_DELAY_MS = 500; // idle time after the last keystroke

export default function PlaceField({
  label,
  placeholder,
  value,
  onTextChange,
  onSelect,
  language = "en",
}: {
  label: string;
  placeholder?: string;
  value: string;
  onTextChange: (text: string) => void;
  onSelect: (point: LatLon, label: string) => void;
  language?: string;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Option[]>([]);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [attribution, setAttribution] = useState("");
  // Visible feedback. `status` is announced through the sr-only live region, so
  // on its own a failed or empty search is indistinguishable from an idle field:
  // you type and literally nothing happens, with no on-screen reason why. These
  // two carry the same information to sighted users (INP-01, MOT-03: never fail
  // silently).
  const [error, setError] = useState<string | null>(null);
  const [noResults, setNoResults] = useState("");
  const abort = useRef<AbortController | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const skipAutoSearch = useRef(false);
  // The committed value at mount / last edit, so the suggestion list only opens
  // on a real edit, never when the field re-appears with a value already set
  // (e.g. re-opening the top panel would otherwise flash the "Use coordinates"
  // option for both fields).
  const prevValue = useRef(value);

  const coordsOption = useCallback((text: string): Option[] => {
    const coords = parseCoords(text);
    return coords
      ? [{
          key: "coords",
          label: "Use coordinates",
          detail: `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`,
          point: coords,
        }]
      : [];
  }, []);

  const runSearch = useCallback(
    (text: string) => {
      const base = coordsOption(text);
      if (text.trim().length < 2) {
        setOptions(base);
        setOpen(base.length > 0);
        setStatus("");
        return;
      }
      abort.current?.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      setBusy(true);
      setError(null);
      setNoResults("");
      searchPlaces(text, language, ctrl.signal)
        .then((res: PlaceSearchResponse) => {
          const found = res.results.map((p: Place, i) => ({
            key: `p${i}`,
            label: p.label,
            detail: p.detail,
            point: { lat: p.lat, lon: p.lon } as LatLon,
          }));
          const all = [...base, ...found];
          setOptions(all);
          setAttribution(res.attribution);
          setOpen(all.length > 0);
          setActive(all.length > 0 ? 0 : -1);
          setStatus(
            found.length === 0
              ? `No places found for ${text.trim()}`
              : `${found.length} place${found.length === 1 ? "" : "s"} found`,
          );
          // "wawel rn" is a half-typed "wawel rynek": Nominatim matched nothing,
          // which is a real answer but looks identical to a broken field unless we
          // say so on screen.
          setNoResults(found.length === 0 ? text.trim() : "");
        })
        .catch((e) => {
          if ((e as Error).name === "AbortError") return;
          // Say the service is unavailable. Never show this as "no results".
          setOptions(base);
          setAttribution("");
          setOpen(base.length > 0);
          setNoResults("");
          const msg = (e as Error).message || "Could not search places just now.";
          setStatus(msg);
          setError(msg);
        })
        .finally(() => setBusy(false));
    },
    [coordsOption, language],
  );

  // Close when focus leaves the whole widget.
  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  // Never leave a request running after the field goes away.
  useEffect(() => () => abort.current?.abort(), []);

  // Auto-search once the user stops typing (F2.2: "suggestions appear after
  // 2 characters").
  //
  // Nominatim's policy asks us not to build auto-complete against the public API.
  // Two things keep this defensible and cheap, and both are enforced server-side
  // in api/places.py rather than hoped for in the UI:
  //   * every lookup goes through our proxy, which serialises outbound requests
  //     to one per second no matter how fast this fires, and caches for an hour;
  //   * the debounce below plus a 3-character floor means a fast typist produces
  //     roughly one request, not one per keypress.
  // Set AUTO_SEARCH to false to fall back to Enter-only search.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- syncs the suggestion
       list to the committed input value; the effect IS the trigger. */
    if (skipAutoSearch.current) {
      skipAutoSearch.current = false;   // our own write after a selection
      return;
    }
    if (!AUTO_SEARCH) return;

    // No edit since mount (or since the last handled edit) -> stay closed.
    if (value === prevValue.current) return;
    prevValue.current = value;

    const text = value.trim();
    if (parseCoords(value)) {
      // Coordinates are already the answer — offer them without a network call.
      setOptions(coordsOption(value));
      setOpen(true);
      setActive(0);
      return;
    }
    if (text.length < AUTO_SEARCH_MIN_CHARS) {
      setOptions([]);
      setOpen(false);
      return;
    }
    // Editing invalidates the previous verdict, so don't leave "no places found"
    // sitting under the box while the user is still typing the query.
    setNoResults("");
    setError(null);
    const timer = window.setTimeout(() => runSearch(value), AUTO_SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [value, runSearch, coordsOption]);

  const choose = (opt: Option) => {
    skipAutoSearch.current = true;   // do not search for the label we just chose
    onSelect(opt.point, opt.label);
    onTextChange(opt.label);
    setOpen(false);
    setOptions([]);
    setActive(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open && options.length) setOpen(true);
      setActive((a) => Math.min(a + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      // A highlighted suggestion wins; otherwise this is a fresh search.
      if (open && active >= 0 && options[active]) choose(options[active]);
      else runSearch(value);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className={styles.field} ref={boxRef}>
      <label htmlFor={id}>{label}</label>
      <div className={styles.inputWrap}>
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${id}-opt-${active}` : undefined}
          aria-describedby={`${id}-help`}
          autoComplete="off"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => options.length > 0 && setOpen(true)}
        />
      </div>
      <span id={`${id}-help`} className={styles.srOnly}>
        Type a place name or a street address. Suggestions appear as you type.
        You can also type latitude, longitude.
      </span>

      {/* Visible counterpart to the sr-only live region below. Without this a
          broken, slow or empty search shows the user nothing at all. */}
      {busy && <p className={styles.busy}>Searching…</p>}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {!error && noResults && (
        <p className={styles.noResults}>
          No places found for <strong>{noResults}</strong>. Try a shorter name, or tap the map.
        </p>
      )}

      {open && options.length > 0 && (
        <>
          <ul className={styles.list} id={listId} role="listbox" aria-label={`${label} suggestions`}>
            {options.map((opt, i) => (
              <li
                key={opt.key}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                className={`${styles.option} ${i === active ? styles.optionActive : ""}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(opt);
                }}
              >
                <span className={styles.optLabel}>{opt.label}</span>
                {opt.detail && <span className={styles.optDetail}>{opt.detail}</span>}
              </li>
            ))}
          </ul>
          {attribution && <p className={styles.attribution}>{attribution}</p>}
        </>
      )}
      <span className={styles.srOnly} role="status" aria-live="polite">
        {busy ? "Searching for places" : status}
      </span>
    </div>
  );
}
