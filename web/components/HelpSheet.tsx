"use client";

// Help (F9): the estimates disclaimer (SAF-01), a one-tap Call 112 (SAF-02),
// a short glossary (CNT-02), the data sources (UNC-06) and an accessibility
// statement pointer (PRV-06).
import Sheet from "./Sheet";
import { PhoneIcon } from "./icons";
import c from "./content.module.css";

export default function HelpSheet({
  open,
  onClose,
  returnFocusRef,
  onOpenLegend,
}: {
  open: boolean;
  onClose: () => void;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  onOpenLegend: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Help" returnFocusRef={returnFocusRef} labelId="help-title">
      <div className={c.disclaimer}>
        <p>Routes are estimates. Data can be missing or out of date. We never promise a route is safe.</p>
      </div>

      <section className={c.group}>
        <h3 className={c.groupTitle}>In an emergency</h3>
        <p className={c.groupNote}>If you need medical help, call 112, the European emergency number.</p>
        <a className={c.callLink} href="tel:112">
          <PhoneIcon />
          Call 112
        </a>
      </section>

      <section className={c.group}>
        <h3 className={c.groupTitle}>Map legend</h3>
        <p className={c.groupNote}>What the solid lines, dashed lines, ? and ~ mean.</p>
        <div className={c.actions}>
          <button type="button" className={c.callLink} onClick={onOpenLegend} style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border-strong)" }}>
            Open the legend
          </button>
        </div>
      </section>

      <section className={c.group}>
        <h3 className={c.groupTitle}>Words we use</h3>
        <dl className={c.defList}>
          <dt>Known</dt>
          <dd>We have data for this stretch, for the time you chose.</dd>
          <dt>~ Estimated</dt>
          <dd>A typical pattern for the time, not a live reading. Shown with a ~.</dd>
          <dt>No data</dt>
          <dd>We have nothing here. We never treat it as quiet, dim or empty.</dd>
          <dt>Noise</dt>
          <dd>How loud the street is from traffic. We say Quiet, Moderate or Loud.</dd>
          <dt>Light</dt>
          <dd>Whether the street is lit. We say Dim, Moderate or Bright.</dd>
          <dt>Crowds</dt>
          <dd>How busy the area usually is. We say Few, Some or Many people.</dd>
        </dl>
      </section>

      <section className={c.group}>
        <h3 className={c.groupTitle}>Where the data comes from</h3>
        <dl className={c.defList}>
          <dt>Noise</dt>
          <dd>Kraków 2022 traffic-noise map. Covers almost every street.</dd>
          <dt>Light</dt>
          <dd>OpenStreetMap lighting tags. Many streets are not tagged yet.</dd>
          <dt>Crowds</dt>
          <dd>BestTime foot-traffic forecasts. A typical pattern, not live. Venue-based, so some streets have no data.</dd>
        </dl>
      </section>

      <section className={c.group}>
        <h3 className={c.groupTitle}>Accessibility</h3>
        <p className={c.groupNote}>
          We aim for WCAG 2.2 AA. This is a prototype. Tell us what does not work for you so we can fix it.
        </p>
      </section>
    </Sheet>
  );
}
