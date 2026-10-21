import { Menu } from "@base-ui/react/menu";
import type { ComponentProps, ReactNode } from "react";

/* Adapted from moc-console's Base UI dropdown: same compact popup and item
   pattern, with this workspace's router-independent public API. */
function DropdownRoot({ children }: { children: ReactNode }) {
  return <Menu.Root>{children}</Menu.Root>;
}
function DropdownTrigger(props: ComponentProps<typeof Menu.Trigger>) {
  return <Menu.Trigger {...props} />;
}
type DropdownContentProps = {
  children: ReactNode;
  positionerProps?: Partial<
    Omit<ComponentProps<typeof Menu.Positioner>, "children" | "className">
  >;
};

function DropdownContent({
  children,
  positionerProps,
}: DropdownContentProps) {
  return (
    <Menu.Portal>
      <Menu.Positioner
        side="right"
        align="end"
        sideOffset={8}
        collisionAvoidance={{
          side: "flip",
          align: "shift",
          fallbackAxisSide: "end",
        }}
        className="dropdown-positioner"
        {...positionerProps}
      >
        <Menu.Popup className="dropdown-panel">{children}</Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  );
}
function DropdownItem(props: ComponentProps<typeof Menu.Item>) {
  return (
    <Menu.Item
      {...props}
      className={`dropdown-item ${props.className ?? ""}`}
    />
  );
}
export const Dropdown = {
  Root: DropdownRoot,
  Trigger: DropdownTrigger,
  Content: DropdownContent,
  Item: DropdownItem,
};
