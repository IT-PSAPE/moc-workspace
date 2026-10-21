export type SegmentedControlOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type SegmentedControlProps = {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: SegmentedControlOption[];
};

export function SegmentedControl({
  label,
  value,
  onValueChange,
  options,
}: SegmentedControlProps) {
  return (
    <div
      className="inline-flex min-h-[36px] min-w-0 items-center gap-0.5 rounded-[8px] bg-[var(--surface-hover)] p-0.5 max-[767px]:min-h-[44px]"
      role="group"
      aria-label={label}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            className="inline-flex min-h-8 min-w-0 appearance-none items-center justify-center border-0 rounded-[6px] bg-transparent px-3 text-sm font-semibold leading-none text-[var(--ink-secondary)] shadow-none transition-colors enabled:hover:bg-[var(--surface-active)] enabled:hover:text-[var(--ink)] data-[selected=true]:bg-[var(--surface)] data-[selected=true]:text-[var(--ink)] data-[selected=true]:shadow-[var(--shadow-xs)] focus-visible:z-[1] focus-visible:outline-none focus-visible:shadow-[var(--ring-brand)] disabled:cursor-not-allowed disabled:opacity-50 max-[767px]:min-h-10"
            aria-pressed={selected}
            data-selected={selected || undefined}
            disabled={option.disabled}
            onClick={() => {
              if (!selected) onValueChange(option.value);
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
