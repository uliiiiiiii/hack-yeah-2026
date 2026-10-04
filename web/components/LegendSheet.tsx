"use client";

// The map legend (UNC-09): explains the four no-data cues and the route colours.
// Reachable in one tap from the map and from Help.
import Sheet from "./Sheet";
import c from "./content.module.css";

function Line({ color, dash }: { color: string; dash?: boolean }) {
  return (
    <span className={c.swatch} aria-hidden="true">
      <svg viewBox="0 0 56 20">
        <line
          x1="2"
          y1="10"
          x2="54"
          y2="10"
          stroke={color}
          strokeWidth="5"
          strokeLinecap={dash ? "butt" : "round"}
          strokeDasharray={dash ? "6 5" : undefined}
        />
      </svg>
    </span>
  );
}

export default function LegendSheet({
  open,
  onClose,
  returnFocusRef,
}: {
  open: boolean;
  onClose: () => void;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Map legend" returnFocusRef={returnFocusRef} labelId="legend-title">
      <ul className={c.legendList}>
        <li className={c.legendItem}>
          <Line color="var(--route-quiet)" />
          <span className={c.legendText}>
            <strong>Route A (your match)</strong>
            <span>Letter A on the map. Solid line.</span>
          </span>
        </li>
        <li className={c.legendItem}>
          <Line color="var(--route-shortest)" />
          <span className={c.legendText}>
            <strong>Shortest route</strong>
            <span>Letter S. Shown so you can compare.</span>
          </span>
        </li>
        <li className={c.legendItem}>
          <Line color="var(--no-data)" dash />
          <span className={c.legendText}>
            <strong>No data yet</strong>
            <span>A dashed line and a ? mark. We have no data here. We never count it as quiet.</span>
          </span>
        </li>
        <li className={c.legendItem}>
          <span className={c.qdot} aria-hidden="true">?</span>
          <span className={c.legendText}>
            <strong>? mark</strong>
            <span>Sits on a stretch with no data. Tap it to see which factor is missing.</span>
          </span>
        </li>
        <li className={c.legendItem}>
          <span className={c.tilde} aria-hidden="true">~</span>
          <span className={c.legendText}>
            <strong>~ before a word</strong>
            <span>A typical pattern for the time, not a live reading. Example: ~Few people.</span>
          </span>
        </li>
      </ul>
    </Sheet>
  );
}
