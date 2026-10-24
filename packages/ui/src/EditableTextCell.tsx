import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";

export type EditableTextCellProps = {
  label: string;
  value: string;
  onSave: (value: string) => Promise<void>;
  disabled?: boolean;
  readOnly?: boolean;
  maxLength?: number;
  validate?: (value: string) => string | undefined;
};

function normalizeText(value: string, maxLength: number) {
  return value.replace(/[\r\n\u2028\u2029]+/g, " ").slice(0, maxLength);
}

/** A plain-text cell that stays in place while the user edits it. */
export function EditableTextCell({
  label,
  value,
  onSave,
  disabled = false,
  readOnly = false,
  maxLength = 120,
  validate,
}: EditableTextCellProps) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const cell = useRef<HTMLDivElement>(null);
  const baselineRef = useRef(value);
  const savingRef = useRef(false);
  const cancelBlurRef = useRef(false);
  const preserveDraftRef = useRef(false);
  const skipNextValueSyncRef = useRef(false);
  const restoreFocusAfterReadOnlyRef = useRef(false);
  const mountedRef = useRef(false);
  const id = useId();
  const errorId = `editable-text-cell-error-${id}`;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    // Parent rerenders and external updates must never replace a live edit.
    if (
      focused ||
      saving ||
      savingRef.current ||
      preserveDraftRef.current ||
      document.activeElement === cell.current
    ) return;
    if (skipNextValueSyncRef.current) {
      skipNextValueSyncRef.current = false;
      return;
    }
    const next = normalizeText(value, maxLength);
    baselineRef.current = next;
    setDraft(next);
    if (cell.current && cell.current.textContent !== next) {
      cell.current.textContent = next;
    }
  }, [focused, maxLength, readOnly, saving, value]);

  useLayoutEffect(() => {
    if (readOnly || !restoreFocusAfterReadOnlyRef.current) return;
    restoreFocusAfterReadOnlyRef.current = false;
    if (document.activeElement === document.body) cell.current?.focus();
  }, [readOnly]);

  function placeCaretAtEnd() {
    const node = cell.current;
    if (!node) return;
    node.focus();
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function handleFocus() {
    setFocused(true);
    cancelBlurRef.current = false;
    if (!readOnly && !error && !savingRef.current && !preserveDraftRef.current) {
      const current = normalizeText(value, maxLength);
      baselineRef.current = current;
      setDraft(current);
      if (cell.current && cell.current.textContent !== current) {
        cell.current.textContent = current;
      }
    }
  }

  async function commit() {
    if (disabled || readOnly || savingRef.current || cancelBlurRef.current) return;

    const next = normalizeText(cell.current?.textContent ?? draft, maxLength);
    setDraft(next);
    if (cell.current && cell.current.textContent !== next) {
      cell.current.textContent = next;
    }

    const validationError = validate?.(next);
    if (validationError) {
      preserveDraftRef.current = true;
      setError(validationError);
      requestAnimationFrame(placeCaretAtEnd);
      return;
    }

    if (next === baselineRef.current) {
      preserveDraftRef.current = false;
      setError(undefined);
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setError(undefined);
    try {
      await onSave(next);
      if (!mountedRef.current) return;
      preserveDraftRef.current = false;
      baselineRef.current = next;
      setDraft(next);
    } catch (saveError) {
      if (!mountedRef.current) return;
      preserveDraftRef.current = true;
      setError(
        saveError instanceof Error && saveError.message
          ? saveError.message
          : "Could not save this value. Try again.",
      );
      requestAnimationFrame(placeCaretAtEnd);
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  }

  function handleInput() {
    const node = cell.current;
    if (!node || disabled || readOnly || savingRef.current) return;
    const next = normalizeText(node.textContent ?? "", maxLength);
    if (node.textContent !== next) {
      node.textContent = next;
      placeCaretAtEnd();
    }
    setDraft(next);
    if (error) setError(undefined);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled || readOnly || savingRef.current) return;

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (savingRef.current) return;
      const original = baselineRef.current;
      cancelBlurRef.current = true;
      skipNextValueSyncRef.current = true;
      setDraft(original);
      setError(undefined);
      if (cell.current) cell.current.textContent = original;
      cell.current?.blur();
      return;
    }

    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      cell.current?.blur();
    }
    // Tab is intentionally not prevented: native focus navigation triggers blur/save.
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    if (disabled || readOnly || savingRef.current) return;
    const pasted = normalizeText(event.clipboardData.getData("text/plain"), maxLength);
    const selection = window.getSelection();
    const node = cell.current;
    if (!selection || !node) return;

    const range = selection.rangeCount ? selection.getRangeAt(0) : null;
    if (range && node.contains(range.commonAncestorContainer)) {
      range.deleteContents();
      const text = document.createTextNode(pasted);
      range.insertNode(text);
      range.setStartAfter(text);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      node.textContent = pasted;
      placeCaretAtEnd();
    }
    handleInput();
  }

  return (
    <div className="w-full min-w-0">
      <div
        ref={cell}
        role="textbox"
        aria-label={label}
        aria-multiline="false"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        aria-busy={saving || undefined}
        aria-readonly={disabled || readOnly || saving || undefined}
        contentEditable={!disabled && !readOnly && !saving}
        suppressContentEditableWarning
        tabIndex={disabled ? -1 : 0}
        className="block min-h-[36px] w-full min-w-0 border-0 bg-transparent px-2 py-2 text-left [overflow-wrap:anywhere] text-[inherit] leading-[inherit] outline-none focus-visible:shadow-[var(--ring-brand)] max-[767px]:min-h-[44px]"
        onFocus={handleFocus}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onBlur={(event) => {
          setFocused(false);
          if (
            readOnly &&
            !event.relatedTarget &&
            document.activeElement === document.body
          ) {
            restoreFocusAfterReadOnlyRef.current = true;
            if (draft !== baselineRef.current) preserveDraftRef.current = true;
          }
          if (cancelBlurRef.current) {
            cancelBlurRef.current = false;
            return;
          }
          void commit();
        }}
      />
      {error && (
        <p
          id={errorId}
          className="m-0 px-2 pb-1 text-xs leading-5 text-[var(--danger-text)]"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}
