"use client";

// Map layers (F: the "Layers" control). Lets the user choose which overlays sit on
// the map. These are display-only toggles — they never change the route itself, only
// what is drawn over it, so the map can be made as plain as the user wants (LAY-05).
import Sheet from "./Sheet";
import c from "./content.module.css";

export interface MapLayers {
  noData: boolean; // dashed no-data stretches + "?" markers (UNC-02)
  altRoute: boolean; // the thin shortest-route comparison line (MAP-06)
  quietPlaces: boolean; // markers for user-reported quiet places (BIZ-15, MAP-05)
}

export const DEFAULT_LAYERS: MapLayers = { noData: true, altRoute: true, quietPlaces: true };

function Switch({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className={c.row}>
      <span>
        <span className={c.rowLabel}>{label}</span>
        {desc && <span className={c.rowDesc}>{desc}</span>}
      </span>
      <label className={c.switch}>
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-label={label}
        />
        <span className={c.switchTrack} aria-hidden="true">
          <span className={c.switchThumb} />
        </span>
      </label>
    </div>
  );
}

export default function LayersSheet({
  open,
  onClose,
  returnFocusRef,
  layers,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  layers: MapLayers;
  onChange: (patch: Partial<MapLayers>) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Map layers" returnFocusRef={returnFocusRef} labelId="layers-title">
      <p className={c.groupNote}>Choose what&apos;s drawn over the map. This never changes your route.</p>
      <section className={c.group}>
        <Switch
          label="No-data stretches"
          desc="Dashed line and ? marks where we have no data. We never count these as quiet."
          checked={layers.noData}
          onChange={(v) => onChange({ noData: v })}
        />
        <Switch
          label="Shortest route"
          desc="The thin comparison line, shown alongside your match."
          checked={layers.altRoute}
          onChange={(v) => onChange({ altRoute: v })}
        />
        <Switch
          label="Quiet places"
          desc="Places people reported as quieter at certain times. They are claims, not facts."
          checked={layers.quietPlaces}
          onChange={(v) => onChange({ quietPlaces: v })}
        />
      </section>
    </Sheet>
  );
}
