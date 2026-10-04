"use client";

// A modal dialog/sheet with the accessibility behaviours the spec requires:
// focus moves in on open, Esc closes, focus returns to the trigger, a focus trap
// keeps Tab inside, and the backdrop click closes (LAY-06, AT-04, F11).
import { useCallback, useEffect, useRef } from "react";
import { CloseIcon } from "./icons";
import styles from "./sheet.module.css";

interface SheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  // Element to restore focus to on close (usually the button that opened it).
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  labelId?: string;
}

export default function Sheet({
  open,
  title,
  onClose,
  children,
  returnFocusRef,
  labelId = "sheet-title",
}: SheetProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  const focusablesIn = (root: HTMLElement) =>
    Array.from(
      root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.offsetParent !== null);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        const items = focusablesIn(panelRef.current);
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    // Capture the trigger now: by cleanup time the ref may point elsewhere, and
    // the right element to restore focus to is the one that opened this dialog.
    const restoreTo = returnFocusRef?.current ?? null;
    // Move focus into the dialog (its heading) on open.
    const heading = panel?.querySelector<HTMLElement>("[data-autofocus]") ?? panel;
    heading?.focus();
    return () => {
      restoreTo?.focus?.();
    };
  }, [open, returnFocusRef]);

  if (!open) return null;

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        onKeyDown={onKeyDown}
      >
        <div className={styles.header}>
          <h2 id={labelId} className={styles.title} tabIndex={-1} data-autofocus>
            {title}
          </h2>
          <button type="button" className={styles.close} onClick={onClose}>
            <CloseIcon />
            Close
          </button>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}
