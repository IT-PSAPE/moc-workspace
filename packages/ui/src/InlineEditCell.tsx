import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button as BaseButton } from "@base-ui/react/button";
import { Check, X } from "lucide-react";

export type InlineEditCellEditorArgs<T> = {
  value: T;
  onChange: (value: T) => void;
  disabled: boolean;
};

export type InlineEditCellProps<T> = {
  label: string;
  value: T;
  displayValue: ReactNode;
  onSave: (value: T) => Promise<void>;
  renderEditor: (args: InlineEditCellEditorArgs<T>) => ReactNode;
  disabled?: boolean;
  validate?: (value: T) => string | undefined;
};

export function InlineEditCell<T>({
  label,
  value,
  displayValue,
  onSave,
  renderEditor,
  disabled = false,
  validate,
}: InlineEditCellProps<T>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const rootRegion = useRef<HTMLDivElement>(null);
  const editorRegion = useRef<HTMLDivElement>(null);
  const readButton = useRef<HTMLButtonElement>(null);
  const restoreReadFocus = useRef(false);
  const id = useId();
  const errorId = `inline-edit-error-${id}`;

  useLayoutEffect(() => {
    if (editing || !restoreReadFocus.current) return;

    restoreReadFocus.current = false;
    readButton.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!editing) return;

    const frame = requestAnimationFrame(() => {
      editorRegion.current
        ?.querySelector<HTMLElement>(
          'input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), [tabindex]:not([tabindex="-1"]):not(:disabled)',
        )
        ?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [editing]);

  useEffect(() => {
    if (!editing || !error) return;

    const control = editorRegion.current?.querySelector<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >('input:not([type="button"]):not([type="submit"]):not([type="reset"]), select, textarea');
    if (!control) return;

    const previousDescription = control.getAttribute("aria-describedby");
    const previousInvalid = control.getAttribute("aria-invalid");
    const descriptionIds = (previousDescription ?? "").split(/\s+/).filter(Boolean);
    if (!descriptionIds.includes(errorId)) descriptionIds.push(errorId);
    control.setAttribute("aria-describedby", descriptionIds.join(" "));
    control.setAttribute("aria-invalid", "true");
    control.focus();

    return () => {
      if (previousDescription === null) {
        control.removeAttribute("aria-describedby");
      } else {
        control.setAttribute("aria-describedby", previousDescription);
      }
      if (previousInvalid === null) {
        control.removeAttribute("aria-invalid");
      } else {
        control.setAttribute("aria-invalid", previousInvalid);
      }
    };
  }, [editing, error, errorId]);

  function beginEditing() {
    if (disabled) return;
    rootRegion.current?.focus({ preventScroll: true });
    setDraft(value);
    setError(undefined);
    setEditing(true);
  }

  function cancelEditing() {
    if (saving) return;
    rootRegion.current?.focus({ preventScroll: true });
    setDraft(value);
    setError(undefined);
    restoreReadFocus.current = true;
    setEditing(false);
  }

  async function saveDraft() {
    if (disabled || saving) return;

    const control = editorRegion.current?.querySelector<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >('input:not([type="button"]):not([type="submit"]):not([type="reset"]), select, textarea');
    if (control && !control.checkValidity()) {
      setError(control.validationMessage || "Check this value and try again.");
      return;
    }

    const validationError = validate?.(draft);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(undefined);
    setSaving(true);
    try {
      await onSave(draft);
      rootRegion.current?.focus({ preventScroll: true });
      restoreReadFocus.current = true;
      setEditing(false);
    } catch (saveError) {
      setError(
        saveError instanceof Error && saveError.message
          ? saveError.message
          : "Could not save this value. Try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  function handleEditorKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelEditing();
      return;
    }

    const target = event.target;
    if (
      target instanceof Element &&
      target.closest(
        'button, [role="button"], select, [role="combobox"], textarea, [contenteditable="true"]',
      )
    ) {
      return;
    }
    if (
      target instanceof HTMLInputElement &&
      ["button", "submit", "reset", "checkbox", "radio", "file"].includes(
        target.type,
      )
    ) {
      return;
    }
    if (
      event.key === "Enter" &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void saveDraft();
    }
  }

  return (
    <div className="w-full min-w-0" ref={rootRegion} tabIndex={-1}>
      {!editing ? (
        <button
          ref={readButton}
          type="button"
          className="block min-h-[36px] w-full min-w-0 rounded-[8px] border border-transparent bg-transparent px-2 text-left [overflow-wrap:anywhere] text-[inherit] leading-[inherit] transition-colors enabled:hover:border-[var(--line)] enabled:hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:shadow-[var(--ring-brand)] disabled:cursor-not-allowed disabled:opacity-55 max-[767px]:min-h-[44px]"
          aria-label={`Edit ${label}`}
          disabled={disabled}
          onClick={beginEditing}
        >
          {displayValue}
        </button>
      ) : (
        <div
          className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2 max-[767px]:grid-cols-1"
          onKeyDown={handleEditorKeyDown}
          aria-busy={saving || undefined}
        >
          <div className="inline-edit-cell__input min-w-0" ref={editorRegion}>
            {renderEditor({
              value: draft,
              onChange: (nextValue) => {
                setDraft(nextValue);
                setError(undefined);
              },
              disabled: disabled || saving,
            })}
          </div>
          <div className="inline-flex items-center gap-1 max-[767px]:justify-end">
            <BaseButton
              type="button"
              className="button button-primary button-sm min-h-8 w-8 min-w-8 rounded-[8px] p-0 text-base max-[767px]:min-h-11 max-[767px]:w-11 max-[767px]:min-w-11"
              aria-label={`Save ${label}`}
              title="Save"
              disabled={disabled || saving}
              onClick={() => void saveDraft()}
            >
              <Check aria-hidden="true" size={16} strokeWidth={2} />
            </BaseButton>
            <BaseButton
              type="button"
              className="button button-secondary button-sm min-h-8 w-8 min-w-8 rounded-[8px] p-0 text-base max-[767px]:min-h-11 max-[767px]:w-11 max-[767px]:min-w-11"
              aria-label={`Cancel editing ${label}`}
              title="Cancel"
              disabled={saving}
              onClick={cancelEditing}
            >
              <X aria-hidden="true" size={16} strokeWidth={2} />
            </BaseButton>
          </div>
          {error && (
            <span
              className="col-span-full text-[var(--danger-text)] text-xs leading-5"
              id={errorId}
              role="alert"
            >
              {error}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
