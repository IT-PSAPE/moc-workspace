import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Combobox } from "@base-ui/react/combobox";
import { Check, Plus } from "lucide-react";

export type CellComboboxOption = {
  value: string;
  label: string;
  icon?: ReactNode;
};

export type CellComboboxProps = {
  label: string;
  value: string[];
  options: CellComboboxOption[];
  onValueChange: (values: string[]) => Promise<void>;
  onCreate?: (label: string) => Promise<void>;
  multiple?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  displayValue?: ReactNode;
  placeholder?: string;
  createLabel?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

type CellComboboxEntry = CellComboboxOption & {
  kind: "option" | "create";
};

function normalizedLabel(value: string) {
  return value.trim().toLocaleLowerCase();
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "Could not update this value. Try again.";
}

export function CellCombobox({
  label,
  value,
  options,
  onValueChange,
  onCreate,
  multiple = false,
  disabled = false,
  readOnly = false,
  displayValue,
  placeholder = "Not set",
  createLabel = "Create new",
  open: controlledOpen,
  onOpenChange,
}: CellComboboxProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const busyRef = useRef(false);
  const focusInputWhenReady = useRef(false);
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  function setOpen(nextOpen: boolean) {
    if (controlledOpen === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const trimmedQuery = query.trim();
  const normalizedQuery = normalizedLabel(trimmedQuery);
  const duplicate = Boolean(
    normalizedQuery &&
      options.some((option) => normalizedLabel(option.label) === normalizedQuery),
  );
  const createValue = useMemo(() => {
    const optionValues = new Set(options.map((option) => option.value));
    let candidate = `__cell-combobox-create:${id}`;
    while (optionValues.has(candidate)) candidate += ":";
    return candidate;
  }, [id, options]);
  const entries = useMemo<CellComboboxEntry[]>(() => {
    const optionEntries = options.map((option) => ({ ...option, kind: "option" as const }));
    return onCreate
      ? [
          ...optionEntries,
          {
            value: createValue,
            label: "",
            kind: "create" as const,
          },
        ]
      : optionEntries;
  }, [options, onCreate, createValue]);
  const filteredOptions = useMemo(() => {
    if (!normalizedQuery) return entries.filter((entry) => entry.kind === "option");
    return entries.filter(
      (entry) =>
        entry.kind === "option" &&
        normalizedLabel(entry.label).includes(normalizedQuery),
    );
  }, [entries, normalizedQuery]);
  const filteredEntries = useMemo(
    () =>
      onCreate
        ? [
            ...filteredOptions,
            entries.find((entry) => entry.kind === "create")!,
          ]
        : filteredOptions,
    [entries, filteredOptions, onCreate],
  );
  const selectedLabels = value
    .map((selectedValue) => options.find((option) => option.value === selectedValue)?.label)
    .filter((selectedLabel): selectedLabel is string => Boolean(selectedLabel));
  const triggerContent =
    displayValue ??
    (selectedLabels.length > 0 ? selectedLabels.join(", ") : placeholder);

  // Busy disables the input during the async mutation. Restore focus after it
  // becomes enabled again, for successful multi-selects and for failures.
  useLayoutEffect(() => {
    if (busy || readOnly || !open || !focusInputWhenReady.current) return;
    focusInputWhenReady.current = false;
    inputRef.current?.focus({ preventScroll: true });
  }, [busy, open, readOnly]);

  async function commitSelection(nextValues: string[]) {
    if (busyRef.current || readOnly) return;
    busyRef.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await onValueChange(nextValues);
      setQuery("");
      if (!multiple) setOpen(false);
      else focusInputWhenReady.current = true;
    } catch (cause) {
      setError(errorMessage(cause));
      setOpen(true);
      focusInputWhenReady.current = true;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function commitCreate() {
    if (
      busyRef.current ||
      readOnly ||
      !onCreate ||
      !trimmedQuery ||
      duplicate
    ) {
      return;
    }

    busyRef.current = true;
    setBusy(true);
    setError(undefined);
    try {
      // Creation and assignment are one caller-owned operation; do not separately
      // call onValueChange with the synthetic create value.
      await onCreate(trimmedQuery);
      setQuery("");
      if (!multiple) setOpen(false);
      else focusInputWhenReady.current = true;
    } catch (cause) {
      setError(errorMessage(cause));
      setOpen(true);
      focusInputWhenReady.current = true;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <Combobox.Root<string, boolean, CellComboboxEntry>
      items={entries}
      filteredItems={filteredEntries}
      multiple={multiple}
      value={multiple ? value : value[0] ?? null}
      disabled={disabled}
      readOnly={readOnly}
      open={open}
      inputValue={query}
      onInputValueChange={(nextQuery) => {
        if (readOnly) return;
        setQuery(nextQuery);
        setError(undefined);
      }}
      onOpenChange={(nextOpen) => {
        if (busyRef.current) return;
        if (nextOpen && readOnly) return;
        setOpen(nextOpen);
        if (nextOpen) setError(undefined);
        else setQuery("");
      }}
      onValueChange={(nextValue, eventDetails) => {
        // Keep Base UI from auto-closing a single-select popup before the async
        // caller commits successfully, or clearing a multi-select query early.
        eventDetails.cancel();
        if (busyRef.current || readOnly) return;
        const nextValues = Array.isArray(nextValue)
          ? [...nextValue]
          : typeof nextValue === "string"
            ? [nextValue]
            : [];
        if (nextValues.includes(createValue)) {
          void commitCreate();
          return;
        }
        if (
          nextValues.length === value.length &&
          nextValues.every((next, index) => next === value[index])
        ) {
          setQuery("");
          if (!multiple) setOpen(false);
          return;
        }
        void commitSelection(nextValues);
      }}
    >
      <Combobox.Trigger
        ref={triggerRef}
        type="button"
        className="inline-flex min-h-9 w-full min-w-0 appearance-none items-center gap-1 border-0 rounded-[8px] bg-transparent px-2 py-1 text-left text-sm leading-5 text-[var(--ink)] outline-none transition-colors focus-visible:shadow-[var(--ring-brand)] disabled:cursor-not-allowed disabled:opacity-55 aria-disabled:cursor-not-allowed aria-disabled:opacity-55 max-[767px]:min-h-11"
        aria-label={`Edit ${label}`}
        aria-disabled={disabled || readOnly || undefined}
        disabled={disabled}
      >
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          {triggerContent}
        </span>
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner
          className="z-[70] outline-none"
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
        >
          <Combobox.Popup
            className="flex max-h-[min(28rem,var(--available-height))] w-[320px] max-w-[var(--available-width)] flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] shadow-[var(--shadow-lg)] outline-none"
            aria-label={`Select ${label}`}
            initialFocus={inputRef}
            finalFocus={triggerRef}
            aria-busy={busy || undefined}
          >
            <div className="flex-none border-b border-[var(--line)] p-2">
              <Combobox.Input
                ref={inputRef}
                className="h-9 w-full min-w-0 rounded-[var(--radius-sm)] border border-[var(--line-control)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] shadow-[var(--shadow-xs)] outline-none placeholder:text-[var(--ink-placeholder)] focus:border-[var(--brand-400)] focus:shadow-[var(--ring-brand)] disabled:cursor-not-allowed disabled:opacity-55 max-[767px]:h-11 max-[767px]:text-base"
                aria-label={`Search ${label}`}
                aria-describedby={error ? errorId : undefined}
                aria-invalid={error ? true : undefined}
                placeholder="Search…"
                maxLength={120}
                disabled={disabled || busy || readOnly}
              />
            </div>
            {filteredOptions.length === 0 && (
              <div
                className="flex-none px-3 py-3 text-sm text-[var(--muted)]"
                role="status"
              >
                {trimmedQuery ? "No results" : "No options"}
              </div>
            )}
            <Combobox.List className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
              {(entry, index) =>
                entry.kind === "create" ? (
                  <Combobox.Item
                    key={entry.value}
                    value={entry.value}
                    index={index}
                    disabled={busy || readOnly || !trimmedQuery || duplicate}
                    className="sticky bottom-0 z-[1] flex min-h-9 cursor-default items-center gap-2 rounded-[var(--radius-sm)] border-t border-[var(--line)] bg-[var(--surface)] px-2 text-sm font-medium text-[var(--ink)] outline-none data-[highlighted]:bg-[var(--surface-hover)] data-[highlighted]:text-[var(--ink)] data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 max-[767px]:min-h-11"
                  >
                    <span className="min-w-0 flex-1 break-words">{createLabel}</span>
                    <Plus className="ml-auto shrink-0" size={16} aria-hidden="true" />
                  </Combobox.Item>
                ) : (
                  <Combobox.Item
                    key={entry.value}
                    value={entry.value}
                    index={index}
                    disabled={busy || readOnly}
                    className="flex min-h-9 cursor-default items-center gap-2 rounded-[var(--radius-sm)] px-2 text-sm text-[var(--ink-secondary)] outline-none data-[highlighted]:bg-[var(--surface-hover)] data-[highlighted]:text-[var(--ink)] data-[selected]:font-semibold data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 max-[767px]:min-h-11"
                  >
                    {entry.icon && <span className="inline-flex shrink-0" aria-hidden="true">{entry.icon}</span>}
                    <span className="min-w-0 flex-1 break-words">
                      <span className="block">{entry.label}</span>
                    </span>
                    <span className="grid size-4 shrink-0 place-items-center rounded-[3px] border border-[var(--line-control)] text-[var(--brand-fill)]" aria-hidden="true">
                      <Combobox.ItemIndicator
                        keepMounted
                        className="grid place-items-center opacity-0 data-[selected]:opacity-100"
                      >
                        <Check size={12} aria-hidden="true" />
                      </Combobox.ItemIndicator>
                    </span>
                  </Combobox.Item>
                )}
            </Combobox.List>
            {error && (
              <div
                className="flex-none border-t border-[var(--line)] px-3 py-2 text-sm text-[var(--danger-text)]"
                id={errorId}
                role="alert"
              >
                {error}
              </div>
            )}
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
