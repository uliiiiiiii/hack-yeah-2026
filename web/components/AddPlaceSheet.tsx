"use client";

// Add a quiet place (F14 simplified / §2O): name, type, entry condition, a
// weekly quiet-hours schedule, and a location chosen on the map. What the user
// declares is a claim — the UI labels it "Reported by a person · Not verified"
// when it is later shown (BIZ-04/05), never "known".
import { useEffect, useId, useState } from "react";
import Sheet from "./Sheet";
import c from "./content.module.css";
import p from "./places.module.css";
import styles from "@/app/page.module.css";
import type { LatLon } from "@/lib/api";
import {
  createPlace,
  DAY_NAMES,
  PlaceRequestError,
  type EntryCondition,
  type Place,
  type QuietHourWindow,
} from "@/lib/places";

export default function AddPlaceSheet({
  open,
  onClose,
  returnFocusRef,
  location,
  onChooseOnMap,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  location: LatLon | null;
  onChooseOnMap: () => void;
  onCreated: (place: Place) => void;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [entry, setEntry] = useState<EntryCondition>("open_to_anyone");
  const [windows, setWindows] = useState<QuietHourWindow[]>([{ day: 1, start: "", end: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Start clean each time the sheet opens (external-driven reset).
  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setName("");
    setType("");
    setEntry("open_to_anyone");
    setWindows([{ day: 1, start: "", end: "" }]);
    setError(null);
    setBusy(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open]);

  const patchWindow = (i: number, patch: Partial<QuietHourWindow>) =>
    setWindows((ws) => ws.map((w, j) => (j === i ? { ...w, ...patch } : w)));
  const removeWindow = (i: number) => setWindows((ws) => ws.filter((_, j) => j !== i));
  const addWindow = () => setWindows((ws) => [...ws, { day: 1, start: "", end: "" }]);

  const save = async () => {
    if (!name.trim()) {
      setError("Give the place a name.");
      return;
    }
    if (!location) {
      setError("Choose a location on the map first.");
      return;
    }
    if (windows.some((w) => (w.start && !w.end) || (!w.start && w.end))) {
      setError("Each quiet-hours time needs a start and an end.");
      return;
    }
    const qh = windows.filter((w) => w.start && w.end);
    if (qh.length === 0) {
      setError("Add at least one quiet-hours time.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const place = await createPlace({
        name: name.trim(),
        type: type.trim(),
        lat: location.lat,
        lon: location.lon,
        entry_condition: entry,
        quiet_hours: qh,
      });
      onCreated(place);
    } catch (e) {
      setError(e instanceof PlaceRequestError ? e.message : "Could not save the place.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Add a quiet place" returnFocusRef={returnFocusRef} labelId="addplace-title">
      <p className={c.groupNote}>
        You are reporting this place. What you say is a claim, shown as &ldquo;Reported by a person&rdquo;, until
        enough visitors agree. We never present a claim as fact.
      </p>

      {/* Location */}
      <div className={p.fieldBlock}>
        <span className={p.fieldLabel}>Location</span>
        {location ? (
          <p className={p.coords} style={{ margin: "0 0 0.4rem" }}>
            {location.lat.toFixed(5)}, {location.lon.toFixed(5)}
          </p>
        ) : (
          <p className={c.groupNote} style={{ margin: "0 0 0.4rem" }}>
            No location chosen yet.
          </p>
        )}
        <button type="button" className={styles.btn} onClick={onChooseOnMap}>
          {location ? "Change on map" : "Choose on map"}
        </button>
      </div>

      {/* Name + type */}
      <div className={p.fieldBlock}>
        <label className={p.fieldLabel} htmlFor={`${id}-name`}>Name</label>
        <input
          id={`${id}-name`}
          className={c.textInput}
          style={{ width: "100%" }}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Bunkier Sztuki"
          maxLength={120}
        />
      </div>
      <div className={p.fieldBlock}>
        <label className={p.fieldLabel} htmlFor={`${id}-type`}>Type</label>
        <input
          id={`${id}-type`}
          className={c.textInput}
          style={{ width: "100%" }}
          value={type}
          onChange={(e) => setType(e.target.value)}
          placeholder="e.g. Museum, cafe, shop"
          maxLength={60}
        />
      </div>

      {/* Entry condition */}
      <div className={p.fieldBlock}>
        <span className={p.fieldLabel}>Who can come in</span>
        <span className={c.segRadio} role="radiogroup" aria-label="Who can come in">
          {(["open_to_anyone", "customers_only", "ask_staff"] as EntryCondition[]).map((v) => (
            <label key={v}>
              <input
                type="radio"
                name="entry"
                checked={entry === v}
                onChange={() => setEntry(v)}
              />
              {v === "open_to_anyone" ? "Open to anyone" : v === "customers_only" ? "Customers only" : "Ask staff"}
            </label>
          ))}
        </span>
      </div>

      {/* Quiet hours */}
      <div className={p.fieldBlock}>
        <span className={p.fieldLabel}>Quiet hours</span>
        <span className={c.groupNote} style={{ margin: "0 0 0.5rem" }}>
          The times when it is quieter here (music off, lights dimmed).
        </span>
        <div className={p.schedule}>
          {windows.map((w, i) => (
            <div className={p.scheduleRow} key={i}>
              <select
                aria-label={`Day for time ${i + 1}`}
                value={w.day}
                onChange={(e) => patchWindow(i, { day: Number(e.target.value) })}
              >
                {DAY_NAMES.map((n, d) => (
                  <option key={d} value={d}>{n}</option>
                ))}
              </select>
              <input
                type="time"
                aria-label={`Start for time ${i + 1}`}
                value={w.start}
                onChange={(e) => patchWindow(i, { start: e.target.value })}
              />
              <input
                type="time"
                aria-label={`End for time ${i + 1}`}
                value={w.end}
                onChange={(e) => patchWindow(i, { end: e.target.value })}
              />
              <button
                type="button"
                className={p.removeBtn}
                onClick={() => removeWindow(i)}
                disabled={windows.length === 1}
                aria-label={`Remove time ${i + 1}`}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <button type="button" className={styles.btn} style={{ marginTop: "0.5rem" }} onClick={addWindow}>
          Add another time
        </button>
      </div>

      {error && (
        <p className={c.groupNote} role="alert" style={{ color: "var(--error)" }}>
          {error}
        </p>
      )}

      <div className={c.actions} style={{ marginTop: "1rem" }}>
        <button type="button" className={styles.primary} style={{ marginTop: 0 }} onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save place"}
        </button>
        <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onClose}>
          Cancel
        </button>
      </div>
    </Sheet>
  );
}
