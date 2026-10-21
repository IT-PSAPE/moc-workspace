import { useEffect, useRef, useState, type FormEvent } from "react";
import { Ellipsis, Plus } from "lucide-react";
import { useWorkspace } from "@moc/client";
import { Button, Dropdown, InlineEditCell, Modal } from "@moc/ui";
import type {
  DepartmentColor,
  DepartmentDefinition,
  WorkspaceAction,
} from "@moc/shared";
import { ConfirmDialog, SideDrawer } from "./components/UiDialogs";
import "./department-table.css";

const colors: DepartmentColor[] = [
  "pink",
  "purple",
  "amber",
  "blue",
  "green",
  "teal",
];

type DepartmentNameDialog = {
  departmentId: string;
  name: string;
};
type GroupNameDialog = {
  departmentId: string;
  original: string | null;
  name: string;
};
type GroupDeleteDialog = { departmentId: string; group: string };
type NewDepartmentDraft = {
  name: string;
  group: string;
  color: DepartmentColor;
};

function normalized(value: string) {
  return value.trim().toLocaleLowerCase();
}

function DepartmentColorValue({ color }: { color: DepartmentColor }) {
  return (
    <span className="inline-flex items-center gap-2 capitalize">
      <span
        className="department-dot size-2.5 shrink-0 rounded-full"
        data-department-color={color}
        aria-hidden="true"
      />
      {color}
    </span>
  );
}

export function DepartmentManagement() {
  const { state, user, act } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [newDepartment, setNewDepartment] =
    useState<NewDepartmentDraft | null>(null);
  const [nameDialog, setNameDialog] = useState<DepartmentNameDialog | null>(null);
  const [groupDrawerId, setGroupDrawerId] = useState<string | null>(null);
  const [groupNameDialog, setGroupNameDialog] =
    useState<GroupNameDialog | null>(null);
  const [groupDeleteDialog, setGroupDeleteDialog] =
    useState<GroupDeleteDialog | null>(null);
  const [deleteDepartmentId, setDeleteDepartmentId] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState("");
  const errorRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const groupInputRef = useRef<HTMLInputElement>(null);
  const canManage =
    user?.approved && user.isLeader && user.department === "cell-0";
  const departments = state?.catalog?.departments ?? [];
  const activeDepartment = departments.find((item) => item.id === groupDrawerId);
  const nameDepartment = departments.find(
    (item) => item.id === nameDialog?.departmentId,
  );
  const groupNameDepartment = departments.find(
    (item) => item.id === groupNameDialog?.departmentId,
  );
  const groupDeleteDepartment = departments.find(
    (item) => item.id === groupDeleteDialog?.departmentId,
  );
  const departmentDeleteTarget = departments.find(
    (item) => item.id === deleteDepartmentId,
  );

  useEffect(() => {
    if (!error) return;
    errorRef.current?.scrollIntoView({ block: "nearest" });
    errorRef.current?.focus({ preventScroll: true });
  }, [error]);

  useEffect(() => {
    if (nameDialog) nameInputRef.current?.focus();
  }, [nameDialog?.departmentId]);

  useEffect(() => {
    if (groupNameDialog) groupInputRef.current?.focus();
  }, [groupNameDialog?.departmentId, groupNameDialog?.original]);

  useEffect(() => {
    if (busy || !dialogError) return;
    if (nameDialog) nameInputRef.current?.focus();
    else if (groupNameDialog) groupInputRef.current?.focus();
  }, [busy, dialogError, nameDialog, groupNameDialog]);

  async function run(action: WorkspaceAction) {
    setBusy(true);
    setError("");
    try {
      await act(action);
    } finally {
      setBusy(false);
    }
  }

  async function saveDepartment(
    department: DepartmentDefinition,
    groupRenames?: Record<string, string>,
  ) {
    await run({ type: "save-department", department, groupRenames });
  }

  function openNameDialog(department: DepartmentDefinition) {
    setError("");
    setDialogError("");
    setNameDialog({ departmentId: department.id, name: department.name });
  }

  async function saveDepartmentName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!nameDialog || !nameDepartment) return;
    const nextName = nameDialog.name.trim();
    if (!nextName) {
      setDialogError("Enter a department name.");
      nameInputRef.current?.focus();
      return;
    }
    if (
      departments.some(
        (department) =>
          department.id !== nameDepartment.id &&
          normalized(department.name) === normalized(nextName),
      )
    ) {
      setDialogError("A department with that name already exists.");
      nameInputRef.current?.focus();
      return;
    }
    setDialogError("");
    try {
      await saveDepartment({ ...nameDepartment, name: nextName });
      setNameDialog(null);
    } catch (cause) {
      setDialogError(
        cause instanceof Error ? cause.message : "Could not rename the department.",
      );
      nameInputRef.current?.focus();
    }
  }

  function openGroupNameDialog(
    department: DepartmentDefinition,
    original: string | null,
  ) {
    setDialogError("");
    setGroupNameDialog({
      departmentId: department.id,
      original,
      name: original ?? "",
    });
  }

  async function saveGroupName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!groupNameDialog || !groupNameDepartment) return;
    const nextName = groupNameDialog.name.trim();
    if (!nextName) {
      setDialogError("Enter a group name.");
      groupInputRef.current?.focus();
      return;
    }
    if (
      groupNameDepartment.groups.some(
        (group) =>
          group !== groupNameDialog.original && normalized(group) === normalized(nextName),
      )
    ) {
      setDialogError("A group with that name already exists in this department.");
      groupInputRef.current?.focus();
      return;
    }
    const groups = groupNameDialog.original
      ? groupNameDepartment.groups.map((group) =>
          group === groupNameDialog.original ? nextName : group,
        )
      : [...groupNameDepartment.groups, nextName];
    const groupRenames =
      groupNameDialog.original && groupNameDialog.original !== nextName
        ? { [groupNameDialog.original]: nextName }
        : undefined;
    setDialogError("");
    try {
      await saveDepartment({ ...groupNameDepartment, groups }, groupRenames);
      setGroupNameDialog(null);
    } catch (cause) {
      setDialogError(
        cause instanceof Error ? cause.message : "Could not save the group.",
      );
      groupInputRef.current?.focus();
    }
  }

  async function createDepartment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newDepartment) return;
    const name = newDepartment.name.trim();
    const group = newDepartment.group.trim();
    if (!name || !group) {
      setError(!name ? "Enter a department name." : "Enter the first group name.");
      return;
    }
    if (departments.some((item) => normalized(item.name) === normalized(name))) {
      setError("A department with that name already exists.");
      return;
    }
    const department: DepartmentDefinition = {
      id: `department-${crypto.randomUUID()}`,
      name,
      groups: [group],
      color: newDepartment.color,
    };
    try {
      await run({ type: "save-department", department });
      setNewDepartment(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not create the department.",
      );
    }
  }

  if (!canManage) return null;

  const canDeleteGroup = (department: DepartmentDefinition, group: string) =>
    department.groups.length > 1;

  const groupUsage = (departmentId: string, group: string) => ({
    members:
      state?.users.filter(
        (member) =>
          member.department === departmentId && member.groups.includes(group),
      ).length ?? 0,
    services:
      state?.catalog.services.filter(
        (service) => service.department === departmentId && service.subTeam === group,
      ).length ?? 0,
  });

  const departmentUsage = (departmentId: string) => ({
    members: state?.users.filter((member) => member.department === departmentId).length ?? 0,
    services:
      state?.catalog.services.filter((service) => service.department === departmentId).length ?? 0,
    tasks: state?.tasks.filter((task) => task.department === departmentId).length ?? 0,
  });

  return (
    <section className="department-management" aria-label="Department management">
      <div className="management-heading">
        <h2>Departments</h2>
        <Button
          variant="primary"
          disabled={busy || Boolean(newDepartment)}
          onClick={() => {
            setError("");
            setNewDepartment({ name: "", group: "", color: "blue" });
          }}
        >
          <Plus size={16} aria-hidden="true" /> New department
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="management-error"
          tabIndex={-1}
          ref={errorRef}
        >
          {error}
        </div>
      )}

      <div
        className="department-table-scroll"
        role="region"
        aria-label="Departments table. Scroll horizontally to see all columns."
        tabIndex={0}
      >
        <table className="department-table">
          <caption className="sr-only">Departments, group counts, calendar colors, and row actions</caption>
          <colgroup>
            <col className="w-[230px]" />
            <col className="w-[240px]" />
            <col className="w-[170px]" />
            <col className="w-[84px]" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Department</th>
              <th scope="col">Groups</th>
              <th scope="col">Color</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {departments.map((department) => (
              <tr key={department.id}>
                <th scope="row" className="min-w-[210px] text-left font-semibold text-[var(--ink)]">
                  {department.name}
                </th>
                <td>
                  <Button
                    size="sm"
                    aria-label={`Manage ${department.groups.length} groups for ${department.name}`}
                    onClick={() => setGroupDrawerId(department.id)}
                  >
                    {department.groups.length} {department.groups.length === 1 ? "group" : "groups"}
                  </Button>
                </td>
                <td>
                  <InlineEditCell
                    label={`${department.name} calendar color`}
                    value={department.color}
                    displayValue={<DepartmentColorValue color={department.color} />}
                    disabled={busy}
                    onSave={(color) => saveDepartment({ ...department, color })}
                    renderEditor={({ value, onChange, disabled }) => (
                      <select
                        aria-label={`${department.name} calendar color`}
                        value={value}
                        disabled={disabled}
                        onChange={(event) => onChange(event.target.value as DepartmentColor)}
                      >
                        {colors.map((color) => (
                          <option key={color} value={color}>{color}</option>
                        ))}
                      </select>
                    )}
                  />
                </td>
                <td>
                  <Dropdown.Root>
                    <Dropdown.Trigger
                      type="button"
                      aria-label={`Actions for ${department.name}`}
                      className="button button-ghost button-sm min-h-9 w-9 p-0"
                    >
                      <Ellipsis size={18} aria-hidden="true" />
                    </Dropdown.Trigger>
                    <Dropdown.Content>
                      <Dropdown.Item onClick={() => openNameDialog(department)}>
                        Rename
                      </Dropdown.Item>
                      {department.id !== "cell-0" && (
                        <Dropdown.Item onClick={() => setDeleteDepartmentId(department.id)}>
                          Delete
                        </Dropdown.Item>
                      )}
                    </Dropdown.Content>
                  </Dropdown.Root>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1.5 hidden text-xs text-[var(--muted)] max-[767px]:block" aria-hidden="true">
        Scroll horizontally to see all columns.
      </p>

      <SideDrawer
        open={Boolean(activeDepartment)}
        onClose={() => setGroupDrawerId(null)}
        title={activeDepartment ? `${activeDepartment.name} groups` : "Groups"}
      >
        {activeDepartment && (
          <div className="flex flex-col gap-4">
            <Button
              variant="primary"
              className="self-start"
              onClick={() => openGroupNameDialog(activeDepartment, null)}
            >
              <Plus size={16} aria-hidden="true" /> Add group
            </Button>
            <div className="min-w-0 flex-none rounded-xl border border-[var(--line)]">
              <table className="w-full min-w-full table-fixed border-collapse text-sm">
                <colgroup>
                  <col className="w-[40%]" />
                  <col className="w-[21%]" />
                  <col className="w-[21%]" />
                  <col className="w-[18%]" />
                </colgroup>
                <caption className="sr-only">Groups in {activeDepartment.name}</caption>
                <thead>
                  <tr>
                    <th className="border-b border-[var(--line)] px-2 py-2 text-left text-xs text-[var(--muted)]" scope="col">Name</th>
                    <th className="whitespace-nowrap border-b border-[var(--line)] px-0 py-2 text-center text-xs font-semibold text-[var(--muted)]" scope="col">Members</th>
                    <th className="whitespace-nowrap border-b border-[var(--line)] px-0 py-2 text-center text-xs font-semibold text-[var(--muted)]" scope="col">Services</th>
                    <th className="whitespace-nowrap border-b border-[var(--line)] px-0 py-2 text-center text-xs font-semibold text-[var(--muted)]" scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {activeDepartment.groups.map((group) => {
                    const usage = groupUsage(activeDepartment.id, group);
                    return (
                      <tr key={group}>
                        <th className="border-b border-[var(--line-subtle)] px-2 py-2 text-left font-medium [overflow-wrap:anywhere]" scope="row">{group}</th>
                        <td className="border-b border-[var(--line-subtle)] px-1 py-2 text-center">{usage.members}</td>
                        <td className="border-b border-[var(--line-subtle)] px-1 py-2 text-center">{usage.services}</td>
                        <td className="border-b border-[var(--line-subtle)] px-1 py-2 text-center">
                          <Dropdown.Root>
                            <Dropdown.Trigger
                              type="button"
                              className="button button-ghost button-sm min-h-9 w-9 p-0"
                              aria-label={`Actions for ${group}`}
                            >
                              <Ellipsis size={18} aria-hidden="true" />
                            </Dropdown.Trigger>
                            <Dropdown.Content>
                              <Dropdown.Item onClick={() => openGroupNameDialog(activeDepartment, group)}>
                                Rename
                              </Dropdown.Item>
                              {canDeleteGroup(activeDepartment, group) && (
                                <Dropdown.Item onClick={() => setGroupDeleteDialog({ departmentId: activeDepartment.id, group })}>
                                  Delete
                                </Dropdown.Item>
                              )}
                            </Dropdown.Content>
                          </Dropdown.Root>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </SideDrawer>

      <Modal
        open={Boolean(newDepartment)}
        onClose={() => {
          setNewDepartment(null);
          setError("");
        }}
        title="New department"
      >
        {newDepartment && (
          <form className="flex flex-col gap-4" onSubmit={(event) => void createDepartment(event)}>
            <label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor="new-department-name">
              Department name
              <input
                id="new-department-name"
                className="input"
                autoFocus
                maxLength={120}
                value={newDepartment.name}
                disabled={busy}
                onChange={(event) => {
                  setError("");
                  setNewDepartment({ ...newDepartment, name: event.target.value });
                }}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor="new-department-group">
              First group
              <input
                id="new-department-group"
                className="input"
                maxLength={120}
                value={newDepartment.group}
                disabled={busy}
                onChange={(event) => {
                  setError("");
                  setNewDepartment({ ...newDepartment, group: event.target.value });
                }}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor="new-department-color">
              Calendar color
              <select
                id="new-department-color"
                value={newDepartment.color}
                disabled={busy}
                onChange={(event) =>
                  setNewDepartment({
                    ...newDepartment,
                    color: event.target.value as DepartmentColor,
                  })
                }
              >
                {colors.map((color) => (
                  <option key={color} value={color}>{color}</option>
                ))}
              </select>
            </label>
            {error && <p className="m-0 text-sm text-[var(--danger-text)]" role="alert">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" disabled={busy} onClick={() => setNewDepartment(null)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={busy}>{busy ? "Saving…" : "Create department"}</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={Boolean(nameDialog)}
        onClose={() => {
          setNameDialog(null);
          setDialogError("");
        }}
        title="Rename department"
      >
        <form className="flex flex-col gap-4" onSubmit={(event) => void saveDepartmentName(event)}>
          <label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor="rename-department-name">
            Department name
            <input
              ref={nameInputRef}
              id="rename-department-name"
              className="input"
              maxLength={120}
              value={nameDialog?.name ?? ""}
              disabled={busy}
              onChange={(event) => {
                setDialogError("");
                setNameDialog((current) => current ? { ...current, name: event.target.value } : current);
              }}
            />
          </label>
          {dialogError && <p className="m-0 text-sm text-[var(--danger-text)]" role="alert">{dialogError}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" disabled={busy} onClick={() => setNameDialog(null)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={busy}>{busy ? "Saving…" : "Save name"}</Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(groupNameDialog)}
        onClose={() => {
          setGroupNameDialog(null);
          setDialogError("");
        }}
        title={groupNameDialog?.original ? "Rename group" : "Add group"}
      >
        <form className="flex flex-col gap-4" onSubmit={(event) => void saveGroupName(event)}>
          <label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor="group-name-dialog-input">
            Group name
            <input
              ref={groupInputRef}
              id="group-name-dialog-input"
              className="input"
              maxLength={120}
              value={groupNameDialog?.name ?? ""}
              disabled={busy}
              onChange={(event) => {
                setDialogError("");
                setGroupNameDialog((current) => current ? { ...current, name: event.target.value } : current);
              }}
            />
          </label>
          {dialogError && <p className="m-0 text-sm text-[var(--danger-text)]" role="alert">{dialogError}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" disabled={busy} onClick={() => setGroupNameDialog(null)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={busy}>{busy ? "Saving…" : "Save group"}</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(groupDeleteDialog)}
        onClose={() => setGroupDeleteDialog(null)}
        title="Delete group?"
        description={groupDeleteDialog && groupDeleteDepartment
          ? `Delete ${groupDeleteDialog.group} from ${groupDeleteDepartment.name}? Members, services, or tasks using this group must be reassigned first.`
          : "Delete this group?"}
        confirmLabel="Delete group"
        onConfirm={async () => {
          if (!groupDeleteDialog || !groupDeleteDepartment) return;
          await saveDepartment({
            ...groupDeleteDepartment,
            groups: groupDeleteDepartment.groups.filter((group) => group !== groupDeleteDialog.group),
          });
          setGroupDeleteDialog(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(departmentDeleteTarget) && departmentDeleteTarget?.id !== "cell-0"}
        onClose={() => setDeleteDepartmentId(null)}
        title="Delete department?"
        description={departmentDeleteTarget
          ? `Delete ${departmentDeleteTarget.name}? Reassign its ${departmentUsage(departmentDeleteTarget.id).members} members, ${departmentUsage(departmentDeleteTarget.id).services} services, and ${departmentUsage(departmentDeleteTarget.id).tasks} tasks first.`
          : "Delete this department?"}
        confirmLabel="Delete department"
        onConfirm={async () => {
          if (!departmentDeleteTarget || departmentDeleteTarget.id === "cell-0") return;
          await run({ type: "delete-department", departmentId: departmentDeleteTarget.id });
          setDeleteDepartmentId(null);
        }}
      />
    </section>
  );
}
