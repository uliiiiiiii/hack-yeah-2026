"use client";

// A place-name search field (INP-01): a WAI-ARIA 1.2 combobox with a listbox of
// Nominatim suggestions. Visible label, autocomplete, keyboard support. Typing a
// "lat, lon" pair still works and shows a "Use coordinates" option first.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { parseCoords, searchPlaces, type Place } from "@/lib/geocode";
import type { LatLon } from "@/lib/api";
import styles from "./placefield.module.css";

interface Option {
  key: string;
  label: string;
  detail: string;
  point: LatLon;
}

export default function PlaceField({
  label,
  placeholder,
  value,
  onTextChange,
  onSelect,
  language = "en",
  autoCompleteToken,
}: {
  label: string;
  placeholder?: string;
  value: string;
  onTextChange: (text: string) => void;
  onSelect: (point: LatLon, label: string) => void;
  language?: string;
  autoCompleteToken?: string;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Option[]>([]);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const timer = useRef<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const justSelected = useRef(false);

  const runSearch = useCallback(
    (text: string) => {
      const coords = parseCoords(text);
      const base: Option[] = coords
        ? [{
            key: "coords",
            label: "Use coordinates",
            detail: `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`,
            point: coords,
          }]
        : [];
      if (text.trim().length < 2) {
        setOptions(base);
        setOpen(base.length > 0);
        setLoading(false);
        return;
      }
      abort.current?.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      setLoading(true);
      searchPlaces(text, language, ctrl.signal)
        .then((places: Place[]) => {
          const opts = places.map((p, i) => ({
            key: `p${i}`,
            label: p.label,
            detail: p.detail,
            point: { lat: p.lat, lon: p.lon } as LatLon,
          }));
          const all = [...base, ...opts];
          setOptions(all);
          setOpen(all.length > 0);
          setActive(all.length > 0 ? 0 : -1);
          setStatus(
            all.length === 0 ? "No places found" : `${all.length} place${all.length === 1 ? "" : "s"} found`,
          );
        })
        .catch((e) => {
          if ((e as Error).name === "AbortError") return;
          setOptions(base);
          setOpen(base.length > 0);
          setStatus("Could not search places just now.");
        })
        .finally(() => setLoading(false));
    },
    [language],
  );

  // Debounce typing (~1 req/sec Nominatim policy). Skip right after a selection.
  useEffect(() => {
    if (justSelected.current) {
      justSelected.current = false;
      return;
    }
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => runSearch(value), 350);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [value, runSearch]);

  // Close when focus leaves the whole widget.
  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  const choose = (opt: Option) => {
    justSelected.current = true;
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
      if (open && active >= 0 && options[active]) {
        e.preventDefault();
        choose(options[active]);
      }
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
          autoComplete={autoCompleteToken ?? "off"}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => options.length > 0 && setOpen(true)}
        />
        {loading && <span className={styles.spin} aria-hidden="true" />}
      </div>

      {open && options.length > 0 && (
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
      )}
      <span className={styles.srOnly} role="status" aria-live="polite">
        {status}
      </span>
    </div>
  );
}
