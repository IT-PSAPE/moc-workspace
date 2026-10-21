import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import { Button as BaseButton } from "@base-ui/react/button";
import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import "./inline-edit.css";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
};

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  ...props
}: ButtonProps) {
  return (
    <BaseButton
      {...props}
      className={`button button-${variant} button-${size} ${className}`}
    />
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  className = "",
  side,
  drawerWidth,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
  side?: "left" | "right";
  drawerWidth?: number;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="modal-backdrop" />
        <Dialog.Popup
          className={`modal-panel ${className}`}
          data-side={side}
          style={
            side && drawerWidth
              ? ({ "--drawer-width": `${drawerWidth}px` } as CSSProperties)
              : undefined
          }
          aria-describedby={undefined}
        >
          <div className="modal-heading">
            <Dialog.Title className="modal-title">{title}</Dialog.Title>
            <Dialog.Close className="icon-button" aria-label="Close dialog">
              <X size={16} aria-hidden="true" />
            </Dialog.Close>
          </div>
          <div className="modal-content">{children}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "gold" | "red" | "brand";
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Field({
  label,
  children,
  hint,
  error,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  error?: string;
}) {
  const id = useId();
  const hintId = hint ? `field-hint-${id}` : undefined;
  const errorId = error ? `field-error-${id}` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  let linkedControl = false;

  function linkControl(node: ReactNode): ReactNode {
    return Children.map(node, (child) => {
      if (!isValidElement(child)) return child;

      const element = child as ReactElement<Record<string, unknown>>;
      if (
        !linkedControl &&
        typeof element.type === "string" &&
        ["input", "select", "textarea"].includes(element.type)
      ) {
        linkedControl = true;
        const existingDescription = element.props["aria-describedby"];
        const mergedDescription = [
          typeof existingDescription === "string"
            ? existingDescription
            : undefined,
          describedBy,
        ]
          .filter(Boolean)
          .join(" ");

        return cloneElement(element, {
          "aria-describedby": mergedDescription || undefined,
          "aria-invalid": error ? "true" : element.props["aria-invalid"],
        });
      }

      if (element.props.children === undefined) return child;
      return cloneElement(element, {
        children: linkControl(element.props.children as ReactNode),
      });
    });
  }

  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {linkControl(children)}
      {hint && (
        <span className="field-hint" id={hintId}>
          {hint}
        </span>
      )}
      {error && (
        <span className="field-error" id={errorId}>
          {error}
        </span>
      )}
    </label>
  );
}

export { Dropdown } from "./dropdown";
export { Tooltip, TooltipProvider } from "./tooltip";
export { InlineEditCell } from "./InlineEditCell";
export type {
  InlineEditCellEditorArgs,
  InlineEditCellProps,
} from "./InlineEditCell";
export { SegmentedControl } from "./SegmentedControl";
export type {
  SegmentedControlOption,
  SegmentedControlProps,
} from "./SegmentedControl";
