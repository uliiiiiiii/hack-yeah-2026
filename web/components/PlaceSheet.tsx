"use client";

// Place detail (F17 / §2O/§2P): what the person reported, the trust tier,
// verification label and dates, and the two honest controls — "Is this accurate?"
// (vote) and "I'm here now" (check-in). Reading order follows trust (ACC-12):
// provenance, verification, dates, then the vote.
import { useState } from "react";
import Sheet from "./Sheet";
import c from "./content.module.css";
import p from "./places.module.css";
import styles from "@/app/page.module.css";
import {
  checkinPlace,
  DAY_NAMES,
  ENTRY_CONDITION_LABEL,
  myVote,
  PlaceRequestError,
  setMyVote,
  votePlace,
  type Place,
} from "@/lib/places";
import { CheckIcon, InfoIcon, ThumbDownIcon, ThumbUpIcon, WarningIcon } from "./icons";

const SHOW_COUNTS_MIN = 3; // match the API's [DATA] threshold (ACC-04)

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function windowLabel(w: { day: number; start: string; end: string }): string {
  return `${DAY_NAMES[w.day]} ${w.start}–${w.end}`;
}

export default function PlaceSheet({
  open,
  onClose,
  returnFocusRef,
  place,
  onChanged,
  onRouteThere,
}: {
  open: boolean;
  onClose: () => void;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  place: Place | null;
  onChanged: (place: Place) => void;
  onRouteThere: (place: Place) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [checkedIn, setCheckedIn] = useState(false);

  if (!place) return null;

  const vote = async (value: "accurate" | "not_accurate") => {
    if (busy) return;
    setBusy(true);
    setStatus("");
    try {
      const updated = await votePlace(place.id, value);
      setMyVote(place.id, value);
      onChanged(updated);
      setStatus("Thanks. Your vote was saved.");
    } catch (e) {
      setStatus(e instanceof PlaceRequestError ? e.message : "Could not save your vote.");
    } finally {
      setBusy(false);
    }
  };

  const checkin = async (value: "yes" | "no" | "not_sure" | null) => {
    if (busy) return;
    setBusy(true);
    setStatus("");
    try {
      const updated = await checkinPlace(place.id, value);
      setCheckedIn(true);
      onChanged(updated);
      setStatus(value ? "Thanks for confirming." : "You're marked as here.");
    } catch (e) {
      setStatus(e instanceof PlaceRequestError ? e.message : "Could not save your check-in.");
    } finally {
      setBusy(false);
    }
  };

  const mine = myVote(place.id);
  const a = place.vote_counts.accurate;
  const n = place.vote_counts.not_accurate;
  const countsWord =
    a + n < SHOW_COUNTS_MIN
      ? "Not enough feedback yet."
      : `Accurate ${a}, not accurate ${n}.`;

  const trustLabel =
    place.disputed
      ? "Reported as not accurate"
      : place.trust === "confirmed"
        ? "Confirmed by visitors"
        : "Reported by a person";

  return (
    <Sheet open={open} onClose={onClose} title="Quiet place" returnFocusRef={returnFocusRef} labelId="place-title">
      <h3 className={p.placeName}>{place.name}</h3>
      {place.type && <p className={p.placeType}>{place.type}</p>}

      <p className={p.meta}>
        {ENTRY_CONDITION_LABEL[place.entry_condition]}
      </p>

      <p className={`${p.trust} ${place.disputed ? p.trustDisputed : ""}`}>
        {place.disputed ? <WarningIcon /> : place.trust === "confirmed" ? <CheckIcon /> : <InfoIcon />}
        {trustLabel}
      </p>

      <p className={p.meta}>
        {place.verified ? "Verified" : "Not verified — nobody has checked this yet."}
      </p>
      <p className={p.meta}>
        Posted {fmtDate(place.posted_at)}
        {place.verified && place.verified_at ? ` · verified ${fmtDate(place.verified_at)}` : " · not yet verified"}
      </p>

      {place.disputed && (
        <p className={p.meta} style={{ color: "var(--error)" }}>
          We&apos;ve stopped suggesting this place.
        </p>
      )}

      <hr className={p.divider} />

      <section>
        <span className={p.fieldLabel}>Quiet hours</span>
        {place.quiet_hours.length === 0 ? (
          <p className={c.groupNote}>No quiet hours reported.</p>
        ) : (
          place.quiet_hours.map((w, i) => (
            <div className={p.window} key={i}>
              <span>{windowLabel(w)}</span>
              {place.active_now ? (
                <span className={p.windowNow}>Active now</span>
              ) : (
                <span>{place.next_window ? `Next: ${place.next_window}` : ""}</span>
              )}
            </div>
          ))
        )}
      </section>

      <hr className={p.divider} />

      <section>
        <span className={p.fieldLabel}>Is this accurate?</span>
        <div className={p.voteRow}>
          <button
            type="button"
            className={p.voteBtn}
            aria-pressed={mine === "accurate"}
            onClick={() => vote("accurate")}
            disabled={busy}
          >
            <ThumbUpIcon />
            Accurate
          </button>
          <button
            type="button"
            className={p.voteBtn}
            aria-pressed={mine === "not_accurate"}
            onClick={() => vote("not_accurate")}
            disabled={busy}
          >
            <ThumbDownIcon />
            Not accurate
          </button>
        </div>
        <p className={p.voteCounts}>{countsWord}</p>
      </section>

      <hr className={p.divider} />

      <section>
        <span className={p.fieldLabel}>Mark you&apos;re here</span>
        <div className={p.voteRow}>
          <button type="button" className={p.voteBtn} onClick={() => checkin(null)} disabled={busy}>
            I&apos;m here now
          </button>
        </div>
        {checkedIn && (
          <div className={p.voteRow}>
            {(["yes", "no", "not_sure"] as const).map((v) => (
              <button
                key={v}
                type="button"
                className={p.voteBtn}
                onClick={() => checkin(v)}
                disabled={busy}
              >
                {v === "yes" ? "Yes" : v === "no" ? "No" : "Not sure"}
              </button>
            ))}
          </div>
        )}
        {place.checkin_counts.total > 0 && (
          <p className={p.voteCounts}>
            {place.checkin_counts.total} checked in
            {place.checkin_counts.yes > 0 ? `, ${place.checkin_counts.yes} say it was quiet` : ""}.
          </p>
        )}
      </section>

      {status && (
        <p className={c.groupNote} role="status" aria-live="polite" style={{ marginTop: "0.6rem" }}>
          {status}
        </p>
      )}

      <div className={c.actions} style={{ marginTop: "1rem" }}>
        <button
          type="button"
          className={styles.primary}
          style={{ marginTop: 0 }}
          onClick={() => onRouteThere(place)}
        >
          Route there
        </button>
        <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onClose}>
          Close
        </button>
      </div>
    </Sheet>
  );
}
