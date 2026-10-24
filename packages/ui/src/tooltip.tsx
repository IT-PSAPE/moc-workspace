import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { useId, type ReactElement, type ReactNode } from "react";

export function Tooltip({
  label,
  children,
  side = "right",
}: {
  label: ReactNode;
  children: ReactElement;
  side?: "top" | "right" | "bottom" | "left";
}) {
  const id = useId();
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} aria-describedby={id} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner
          side={side}
          sideOffset={8}
          className="tooltip-positioner"
        >
          <BaseTooltip.Popup id={id} role="tooltip" className="tooltip-popup">
            {label}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
export const TooltipProvider = BaseTooltip.Provider;
