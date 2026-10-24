import type { HTMLAttributes } from "react";

export type BadgeTone = "neutral" | "green" | "gold" | "red" | "brand";
export type BadgeColor = "pink" | "purple" | "amber" | "blue" | "green" | "teal" | "red" | "orange" | "cyan" | "indigo" | "lime" | "slate";

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
  color?: BadgeColor;
};

const colorClasses: Record<BadgeColor, string> = {
  pink: "border-transparent bg-[var(--dept-cell0-bg)] text-[var(--dept-cell0-fg)]",
  purple: "border-transparent bg-[var(--dept-design-bg)] text-[var(--dept-design-fg)]",
  amber: "border-transparent bg-[var(--dept-sound-bg)] text-[var(--dept-sound-fg)]",
  blue: "border-transparent bg-[var(--dept-visual-bg)] text-[var(--dept-visual-fg)]",
  green: "border-transparent bg-[var(--success-bg)] text-[var(--success-text)]",
  teal: "border-transparent bg-[#f0fdfa] text-[#115e59]",
  red: "border-transparent bg-[var(--palette-red-bg)] text-[var(--palette-red-fg)]",
  orange: "border-transparent bg-[var(--palette-orange-bg)] text-[var(--palette-orange-fg)]",
  cyan: "border-transparent bg-[var(--palette-cyan-bg)] text-[var(--palette-cyan-fg)]",
  indigo: "border-transparent bg-[var(--palette-indigo-bg)] text-[var(--palette-indigo-fg)]",
  lime: "border-transparent bg-[var(--palette-lime-bg)] text-[var(--palette-lime-fg)]",
  slate: "border-transparent bg-[var(--palette-slate-bg)] text-[var(--palette-slate-fg)]",
};

export function Badge({
  children,
  tone = "neutral",
  color,
  className = "",
  ...props
}: BadgeProps) {
  return (
    <span
      {...props}
      className={`badge ${color ? colorClasses[color] : `badge-${tone}`} ${className}`.trim()}
    >
      {children}
    </span>
  );
}
