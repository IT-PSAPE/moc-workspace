import { useEffect, useRef, useState, type ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button, Modal } from "@moc/ui";

type SideDrawerProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
};

export function SideDrawer({ open, onClose, title, children }: SideDrawerProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      side="right"
    >
      <div className="flex min-h-full flex-col">{children}</div>
    </Modal>
  );
}

type FilterDrawerProps = {
  activeCount: number;
  onReset: () => void;
  children: ReactNode;
};

export function FilterDrawer({
  activeCount,
  onReset,
  children,
}: FilterDrawerProps) {
  const [open, setOpen] = useState(false);
  const visibleCount = Math.max(0, activeCount);

  return (
    <>
      <Button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <SlidersHorizontal size={16} aria-hidden="true" />
        Filters
        {visibleCount > 0 && (
          <span className="ml-1 rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-xs font-semibold text-[var(--ink)]">
            <span className="sr-only">, </span>{visibleCount}
            <span className="sr-only"> active filters</span>
          </span>
        )}
      </Button>
      <SideDrawer
        open={open}
        onClose={() => setOpen(false)}
        title="Filters"
      >
        <div className="flex flex-1 flex-col gap-5">
          <div className="flex-1 space-y-4">{children}</div>
          <footer className="sticky bottom-0 mt-auto flex items-center justify-between gap-3 border-t border-[var(--line)] bg-[var(--surface)] pt-4">
            <Button type="button" onClick={onReset} disabled={visibleCount === 0}>
              Reset filters
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => setOpen(false)}
            >
              Done
            </Button>
          </footer>
        </div>
      </SideDrawer>
    </>
  );
}

type ConfirmDialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  onConfirm: () => Promise<void>;
  confirmLabel?: string;
};

export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  onConfirm,
  confirmLabel = "Confirm",
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const confirmInFlight = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (!error) return;
    errorRef.current?.focus();
    errorRef.current?.scrollIntoView({ block: "nearest" });
  }, [error]);

  async function confirm() {
    if (confirmInFlight.current) return;
    confirmInFlight.current = true;
    setBusy(true);
    setError("");

    try {
      await onConfirm();
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : "Could not complete this action. Try again.",
      );
    } finally {
      confirmInFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!confirmInFlight.current) {
          setError("");
          onClose();
        }
      }}
      title={title}
    >
      <div className="flex flex-col gap-4">
        <p className="m-0 text-sm leading-6 text-[var(--ink-secondary)]">
          {description}
        </p>
        {error && (
          <p
            ref={errorRef}
            className="m-0 text-sm leading-5 text-[var(--danger-text)]"
            role="alert"
            tabIndex={-1}
          >
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="button button-secondary button-md"
            autoFocus
            disabled={busy}
            onClick={() => {
              setError("");
              onClose();
            }}
          >
            Cancel
          </button>
          <Button
            type="button"
            variant="danger"
            disabled={busy}
            onClick={() => void confirm()}
          >
            {busy ? "Working…" : error ? "Try again" : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
