"use client";

// Settings (F9): Display, Routing, Alerts, Language, Privacy. Each control applies
// instantly (PER-01). Reset to defaults (PER-04). View/Delete my data (PRV-05).
import Sheet from "./Sheet";
import c from "./content.module.css";
import type {
  MaxExtra,
  Settings,
  Strictness,
  TextSize,
  Theme,
} from "@/lib/settings";

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

export default function SettingsSheet({
  open,
  onClose,
  returnFocusRef,
  settings,
  onChange,
  onReset,
  onDeleteData,
}: {
  open: boolean;
  onClose: () => void;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onReset: () => void;
  onDeleteData: () => void;
}) {
  const s = settings;

  return (
    <Sheet open={open} onClose={onClose} title="Settings" returnFocusRef={returnFocusRef} labelId="settings-title">
      {/* Display */}
      <section className={c.group}>
        <h3 className={c.groupTitle}>Display</h3>

        <div className={c.row}>
          <span>
            <span className={c.rowLabel}>Theme</span>
            <span className={c.rowDesc}>Match device, or choose light or dark.</span>
          </span>
          <span className={c.segRadio} role="radiogroup" aria-label="Theme">
            {(["system", "light", "dark"] as Theme[]).map((t) => (
              <label key={t}>
                <input
                  type="radio"
                  name="theme"
                  checked={s.theme === t}
                  onChange={() => onChange({ theme: t })}
                />
                {t === "system" ? "Match device" : t === "light" ? "Light" : "Dark"}
              </label>
            ))}
          </span>
        </div>

        <div className={c.row}>
          <span>
            <span className={c.rowLabel}>Text size</span>
            <span className={c.rowDesc}>Larger text, up to double size.</span>
          </span>
          <select
            className={c.select}
            value={s.textSize}
            onChange={(e) => onChange({ textSize: e.target.value as TextSize })}
            aria-label="Text size"
          >
            <option value="normal">Normal</option>
            <option value="large">Large</option>
            <option value="xlarge">Larger</option>
            <option value="xxlarge">Largest</option>
          </select>
        </div>

        <Switch
          label="Low-stimulation mode"
          desc="Less on screen, no movement, muted colours."
          checked={s.lowStim}
          onChange={(v) => onChange({ lowStim: v })}
        />
        <Switch
          label="Reduce motion"
          desc="Turn off animations and camera movement."
          checked={s.reduceMotion}
          onChange={(v) => onChange({ reduceMotion: v })}
        />
      </section>

      {/* Routing */}
      <section className={c.group}>
        <h3 className={c.groupTitle}>Routing</h3>

        <div className={c.row}>
          <span>
            <span className={c.rowLabel}>Strictness</span>
            <span className={c.rowDesc}>Strict avoids harder, even if it takes longer.</span>
          </span>
          <span className={c.segRadio} role="radiogroup" aria-label="Strictness">
            {(["flexible", "strict"] as Strictness[]).map((t) => (
              <label key={t}>
                <input
                  type="radio"
                  name="strictness"
                  checked={s.strictness === t}
                  onChange={() => onChange({ strictness: t })}
                />
                {t === "flexible" ? "Flexible" : "Strict"}
              </label>
            ))}
          </span>
        </div>

        <div className={c.row}>
          <span>
            <span className={c.rowLabel}>Most extra time</span>
            <span className={c.rowDesc}>How much longer than the shortest route is allowed.</span>
          </span>
          <select
            className={c.select}
            value={s.maxExtra === null ? "none" : String(s.maxExtra)}
            onChange={(e) =>
              onChange({
                maxExtra: e.target.value === "none" ? null : (Number(e.target.value) as MaxExtra),
              })
            }
            aria-label="Most extra time"
          >
            <option value="5">+5 min</option>
            <option value="10">+10 min</option>
            <option value="20">+20 min</option>
            <option value="none">No limit</option>
          </select>
        </div>

        <Switch
          label="Prefer routes with more data"
          desc="When routes are close, pick the one we know more about."
          checked={s.preferMoreData}
          onChange={(v) => onChange({ preferMoreData: v })}
        />
      </section>

      {/* Alerts */}
      <section className={c.group}>
        <h3 className={c.groupTitle}>Alerts</h3>
        <Switch label="Vibration" checked={s.haptics} onChange={(v) => onChange({ haptics: v })} />
        <Switch label="Sound" checked={s.sound} onChange={(v) => onChange({ sound: v })} />
        <Switch
          label="Cues while walking"
          desc="Show a calm note before a stretch with no data."
          checked={s.inWalkCues}
          onChange={(v) => onChange({ inWalkCues: v })}
        />
      </section>

      {/* Language */}
      <section className={c.group}>
        <h3 className={c.groupTitle}>Language</h3>
        <div className={c.row}>
          <span className={c.rowLabel}>App language</span>
          <select
            className={c.select}
            value={s.language}
            onChange={(e) => onChange({ language: e.target.value as Settings["language"] })}
            aria-label="App language"
          >
            <option value="en">English</option>
            <option value="pl">Polski</option>
            <option value="uk">Українська</option>
          </select>
        </div>
        <p className={c.groupNote}>Only the page language is set for now. Full translations are coming.</p>
      </section>

      {/* Call someone */}
      <section className={c.group}>
        <h3 className={c.groupTitle}>Someone to call</h3>
        <p className={c.groupNote}>A phone number for the Call someone button. Saved only on this device.</p>
        <input
          className={c.textInput}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="e.g. +48 600 000 000"
          value={s.savedContact}
          onChange={(e) => onChange({ savedContact: e.target.value })}
          aria-label="Someone to call phone number"
          style={{ width: "100%" }}
        />
      </section>

      {/* Privacy */}
      <section className={c.group}>
        <h3 className={c.groupTitle}>Privacy and data</h3>
        <p className={c.groupNote}>
          Your settings stay on this device. We do not send your profile anywhere. Location is used only while you plan or walk.
        </p>
        <div className={c.actions}>
          <button type="button" className={c.callLink} onClick={onReset} style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border-strong)" }}>
            Reset to defaults
          </button>
          <button type="button" className={c.callLink} onClick={onDeleteData} style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--error)" }}>
            Delete all my data
          </button>
        </div>
      </section>
    </Sheet>
  );
}
