import { type ComponentProps } from "react";
import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { Check } from "lucide-react";
import { cn } from "./utils";

function Root({ className, ...props }: ComponentProps<typeof BaseCheckbox.Root>) {
  return (
    <BaseCheckbox.Root
      data-slot="checkbox"
      className={(state) => cn(
        "inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-[4px] border border-[var(--line-control)] bg-[var(--surface)] p-0 align-middle text-[var(--ink-on-brand)] shadow-[var(--shadow-xs)] data-[checked]:border-[var(--brand-fill)] data-[checked]:bg-[var(--brand-fill)] data-[indeterminate]:border-[var(--brand-fill)] data-[indeterminate]:bg-[var(--brand-fill)] focus-visible:outline-none focus-visible:shadow-[var(--ring-brand)] data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40",
        typeof className === "function" ? className(state) : className,
      )}
      {...props}
    />
  );
}

function Indicator({ className, children = <Check size={12} strokeWidth={2.5} aria-hidden="true" />, ...props }: ComponentProps<typeof BaseCheckbox.Indicator>) {
  return (
    <BaseCheckbox.Indicator
      data-slot="checkbox-indicator"
      className={(state) => cn("inline-flex items-center justify-center", typeof className === "function" ? className(state) : className)}
      {...props}
    >
      {children}
    </BaseCheckbox.Indicator>
  );
}

export const Checkbox = { Root, Indicator };
