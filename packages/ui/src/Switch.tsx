import { useId } from "react";
import { cn } from "./utils";

export type SwitchProps = {
  checked: boolean;
  disabled?: boolean;
  name: string;
  onChange: (checked: boolean) => void;
  help?: string;
  compact?: boolean;
  className?: string;
};

export function Switch({
  checked,
  disabled = false,
  name,
  onChange,
  help,
  compact = false,
  className,
}: SwitchProps) {
  const helpId = useId();
  return (
    <label className={cn("relative inline-flex min-w-[46px] cursor-pointer items-center gap-2 text-sm text-[var(--ink-secondary)] max-[767px]:min-h-11", className)}>
      {!compact && (
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <strong className="text-sm text-[var(--ink)]">{name}</strong>
          {help && <small id={helpId} className="text-xs leading-snug text-[var(--muted)]">{help}</small>}
        </span>
      )}
      <input
        type="checkbox"
        role="switch"
        className="peer sr-only"
        aria-label={name}
        aria-describedby={!compact && help ? helpId : undefined}
        aria-checked={checked}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span
        aria-hidden="true"
        className="relative inline-block h-[21px] w-9 shrink-0 rounded-full border border-[var(--line-strong)] bg-[var(--neutral-200)] transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-[15px] after:rounded-full after:bg-[var(--surface)] after:shadow-[var(--shadow-xs)] after:transition-transform after:content-[''] peer-checked:border-[var(--brand-600)] peer-checked:bg-[var(--brand-600)] peer-checked:after:translate-x-[15px] peer-focus-visible:shadow-[var(--ring-brand)] peer-disabled:cursor-not-allowed peer-disabled:opacity-65 peer-checked:peer-disabled:border-[var(--brand-400)] peer-checked:peer-disabled:bg-[var(--brand-400)]"
      />
      {compact && <span className="text-xs font-semibold text-[var(--muted)]">{checked ? "On" : "Off"}</span>}
    </label>
  );
}
