import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ContextMenu } from "@base-ui/react/context-menu";
import { Menu } from "@base-ui/react/menu";
import {
  Building2,
  Ellipsis,
  Pencil,
  Trash2,
} from "lucide-react";
import type { DepartmentDefinition } from "@moc/shared";
import { useWorkspace } from "@moc/client";
import { Button, Field, Modal } from "@moc/ui";
import { ConfirmDialog } from "./components/UiDialogs";

type SidebarDepartmentNavMenuProps = {
  department: DepartmentDefinition;
  children: ReactNode;
};

export function SidebarDepartmentNavMenu({
  department,
  children,
}: SidebarDepartmentNavMenuProps) {
  const { user, act } = useWorkspace();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [name, setName] = useState(department.name);
  const [saving, setSaving] = useState(false);
  const [renameError, setRenameError] = useState("");
  const [contextOpen, setContextOpen] = useState(false);
  const actionsButton = useRef<HTMLButtonElement>(null);

  const canManage = Boolean(
    user?.approved && user.isLeader && user.department === "cell-0",
  );

  if (!canManage) return <>{children}</>;

  function openRename() {
    setName(department.name);
    setRenameError("");
    setRenameOpen(true);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") {
      event.preventDefault();
      actionsButton.current?.focus();
      setMenuOpen(true);
    }
  }

  async function saveName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName) {
      setRenameError("Enter a department name.");
      return;
    }

    setSaving(true);
    setRenameError("");
    try {
      await act({
        type: "save-department",
        department: { ...department, name: nextName },
      });
      setRenameOpen(false);
    } catch (cause) {
      setRenameError(
        cause instanceof Error && cause.message
          ? cause.message
          : "Could not rename this department. Try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <ContextMenu.Root open={contextOpen} onOpenChange={setContextOpen}>
      <ContextMenu.Trigger
        className="group/dept-menu relative flex w-full min-w-0 items-center"
        onKeyDown={handleKeyDown}
      >
        {children}
        <Menu.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <Menu.Trigger
            ref={actionsButton}
            type="button"
            className="icon-button absolute right-1 top-1/2 z-10 -translate-y-1/2 bg-[var(--surface)] opacity-0 pointer-events-none group-hover/dept-menu:pointer-events-auto group-hover/dept-menu:opacity-100 group-focus-within/dept-menu:pointer-events-auto group-focus-within/dept-menu:opacity-100 max-[767px]:pointer-events-auto max-[767px]:opacity-100"
            aria-label={`Actions for ${department.name}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
          >
            <Ellipsis size={18} aria-hidden="true" />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner
              side="right"
              align="start"
              sideOffset={4}
              collisionAvoidance={{ side: "flip", align: "shift" }}
              className="dropdown-positioner"
            >
              <Menu.Popup className="dropdown-panel">
                <Menu.Item className="dropdown-item" onClick={openRename}>
                  <Pencil size={16} aria-hidden="true" />
                  Rename
                </Menu.Item>
                <Menu.LinkItem
                  className="dropdown-item"
                  href="/settings#departments"
                >
                  <Building2 size={16} aria-hidden="true" />
                  Manage departments
                </Menu.LinkItem>
                {department.id !== "cell-0" && (
                  <Menu.Item
                    className="dropdown-item"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                    Delete
                  </Menu.Item>
                )}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="dropdown-positioner">
          <ContextMenu.Popup className="dropdown-panel">
            <ContextMenu.Item className="dropdown-item" onClick={openRename}>
              <Pencil size={16} aria-hidden="true" />
              Rename
            </ContextMenu.Item>
            <ContextMenu.LinkItem
              className="dropdown-item"
              href="/settings#departments"
            >
              <Building2 size={16} aria-hidden="true" />
              Manage departments
            </ContextMenu.LinkItem>
            {department.id !== "cell-0" && (
              <ContextMenu.Item
                className="dropdown-item"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 size={16} aria-hidden="true" />
                Delete
              </ContextMenu.Item>
            )}
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
      <Modal
        open={renameOpen}
        onClose={() => {
          if (!saving) setRenameOpen(false);
        }}
        title="Rename department"
      >
        <form className="flex flex-col gap-4 p-4 sm:p-5" onSubmit={saveName}>
          <Field label="Department name" error={renameError || undefined}>
            <input
              autoFocus
              className="input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              disabled={saving}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              onClick={() => setRenameOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? "Saving…" : "Save name"}
            </Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={`Delete ${department.name}?`}
        description="This department can only be deleted when no members, services, or tasks use it."
        confirmLabel="Delete department"
        onConfirm={async () => {
          await act({ type: "delete-department", departmentId: department.id });
        }}
      />
    </ContextMenu.Root>
  );
}
