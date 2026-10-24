import { useEffect, useRef, useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useWorkspace } from "@moc/client";
import {
  Badge,
  Button,
  CellCombobox,
  DataTable,
  EditableTextCell,
  Modal,
  type DataTableColumnDef,
} from "@moc/ui";
import {
  DEPARTMENT_COLORS,
  type DepartmentColor,
  type DepartmentDefinition,
  type WorkspaceAction,
} from "@moc/shared";
import { ConfirmDialog } from "./components/UiDialogs";

type NewDepartmentDraft = {
  name: string;
  group: string;
  color: DepartmentColor;
};

function normalized(value: string) {
  return value.trim().toLocaleLowerCase();
}

function DepartmentColorValue({ color }: { color: DepartmentColor }) {
  return <Badge color={color} className="before:hidden"><span className="size-3 shrink-0 rounded-full bg-current" aria-hidden="true" />{color[0].toUpperCase() + color.slice(1)}</Badge>;
}

function DepartmentGroupsCell({ department, busy, onSave }: Pick<DepartmentRow, "department" | "busy" | "onSave">) {
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState<string[]>([]);
  return (
    <>
      <CellCombobox
        label={`${department.name} groups`}
        multiple
        open={open}
        onOpenChange={setOpen}
        value={department.groups}
        options={department.groups.map((group) => ({ value: group, label: group }))}
        displayValue={<span className="flex flex-wrap gap-1.5">{department.groups.map((group) => <Badge key={group} color={department.color}>{group}</Badge>)}</span>}
        readOnly={busy}
        createLabel="Create new group"
        onCreate={(group) => onSave({ ...department, groups: [...department.groups, group] })}
        onValueChange={async (groups) => {
          if (!groups.length) throw new Error("Keep at least one group in this department.");
          const removed = department.groups.filter((group) => !groups.includes(group));
          if (removed.length) {
            setOpen(false);
            setRemoving(removed);
          }
        }}
      />
      <ConfirmDialog
        open={removing.length > 0}
        onClose={() => setRemoving([])}
        title="Delete group?"
        description={`Delete ${removing.join(", ")} from ${department.name}? Members, services, or tasks using this group must be reassigned first.`}
        confirmLabel="Delete group"
        onConfirm={() => onSave({ ...department, groups: department.groups.filter((group) => !removing.includes(group)) })}
      />
    </>
  );
}

type DepartmentRow = {
  department: DepartmentDefinition;
  busy: boolean;
  savingColorId: string | null;
  validateName: (department: DepartmentDefinition, value: string) => string | undefined;
  onSave: (department: DepartmentDefinition) => Promise<void>;
  onSaveColor: (department: DepartmentDefinition, color: DepartmentColor) => Promise<void>;
};

function DepartmentSelectionActions({
  departments,
  busy,
  onDelete,
}: {
  departments: DepartmentDefinition[];
  busy: boolean;
  onDelete: () => Promise<void>;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <>
      <Button variant="danger" disabled={busy} onClick={() => setConfirmOpen(true)}>
        <Trash2 size={16} aria-hidden="true" /> Delete departments
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Delete departments?"
        description={`Delete ${departments.length} ${departments.length === 1 ? "department" : "departments"}: ${departments.map((department) => department.name).join(", ")}? Departments with assigned members, services, or tasks must be reassigned first. If any selected department is in use, none will be deleted.`}
        confirmLabel="Delete departments"
        onConfirm={onDelete}
      />
    </>
  );
}

const colorOptions = DEPARTMENT_COLORS.map((color) => ({
  value: color,
  label: color[0].toUpperCase() + color.slice(1),
  icon: <span data-department-color={color} className="size-3.5 rounded-full bg-[var(--department-fg)]" />,
}));

// Keep cell components mounted while an inline save updates the row.
const departmentColumns: DataTableColumnDef<DepartmentRow>[] = [
  DataTable.createSelectionColumn<DepartmentRow>({
    getLabel: ({ department }) => `Select ${department.name}`,
  }),
  {
    id: "department",
    header: "Department",
    meta: {
      rowHeader: true,
      label: "Department",
      headerClassName: "w-[32%]",
      className: "p-0 text-sm font-semibold whitespace-normal text-[var(--ink)]",
    },
    cell: ({ row }) => {
      const { department, busy, validateName, onSave } = row.original;
      return (
        <EditableTextCell
          label={`${department.name} department name`}
          value={department.name}
          readOnly={busy}
          validate={(value) => validateName(department, value)}
          onSave={(name) => onSave({ ...department, name: name.trim() })}
        />
      );
    },
  },
  {
    id: "groups",
    header: "Groups",
    meta: { label: "Groups", headerClassName: "w-[48%]", className: "p-0" },
    cell: ({ row }) => <DepartmentGroupsCell {...row.original} />,
  },
  {
    id: "color",
    header: "Color",
    meta: { label: "Color", headerClassName: "w-[20%]", className: "p-0" },
    cell: ({ row }) => {
      const { department, busy, savingColorId, onSaveColor } = row.original;
      return (
        <CellCombobox
          label={`${department.name} calendar color`}
          value={[department.color]}
          options={colorOptions}
          displayValue={<DepartmentColorValue color={department.color} />}
          readOnly={busy && savingColorId !== department.id}
          onValueChange={async ([color]) => {
            if (color) await onSaveColor(department, color as DepartmentColor);
          }}
        />
      );
    },
  },
];

const getDepartmentRowId = (row: DepartmentRow) => row.department.id;

export function DepartmentManagement() {
  const { state, user, act } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [newDepartment, setNewDepartment] =
    useState<NewDepartmentDraft | null>(null);
  const [savingColorId, setSavingColorId] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const canManage =
    user?.approved && user.isLeader && user.department === "cell-0";
  const departments = state?.catalog?.departments ?? [];

  useEffect(() => {
    if (!error) return;
    errorRef.current?.scrollIntoView({ block: "nearest" });
    errorRef.current?.focus({ preventScroll: true });
  }, [error]);

  async function run(action: WorkspaceAction) {
    setBusy(true);
    setError("");
    try {
      await act(action);
    } finally {
      setBusy(false);
    }
  }

  async function saveDepartment(department: DepartmentDefinition) {
    await run({ type: "save-department", department });
  }

  async function saveDepartmentColor(
    department: DepartmentDefinition,
    color: DepartmentColor,
  ) {
    setSavingColorId(department.id);
    try {
      await saveDepartment({ ...department, color });
    } finally {
      setSavingColorId(null);
    }
  }

  function validateDepartmentName(department: DepartmentDefinition, value: string) {
    const nextName = value.trim();
    if (!nextName) return "Enter a department name.";
    if (
      departments.some(
        (item) =>
          item.id !== department.id && normalized(item.name) === normalized(nextName),
      )
    ) {
      return "A department with that name already exists.";
    }
    return undefined;
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

  return (
    <section className="department-management flex min-w-0 flex-col gap-4" aria-label="Department management">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-lg font-semibold text-[var(--ink)]">Departments</h2>
        <Button
          variant="primary"
          className="ml-auto"
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
          className="rounded-[var(--radius-sm)] border border-[var(--danger-border)] bg-[var(--danger-bg)] px-4 py-3 text-sm text-[var(--danger-text)]"
          tabIndex={-1}
          ref={errorRef}
        >
          {error}
        </div>
      )}

      <DataTable.Root
        columns={departmentColumns}
        data={departments.map<DepartmentRow>((department) => ({
          department,
          busy,
          savingColorId,
          validateName: validateDepartmentName,
          onSave: saveDepartment,
          onSaveColor: saveDepartmentColor,
        }))}
        getRowId={getDepartmentRowId}
        enableRowSelection={(row) => !busy && row.original.department.id !== "cell-0"}
      >
        <DataTable.SelectionBar<DepartmentRow> disabled={busy}>
          {({ selectedRows, clearSelection }) => (
            <DepartmentSelectionActions
              departments={selectedRows.map((row) => row.department)}
              busy={busy}
              onDelete={async () => {
                await run({ type: "delete-departments", departmentIds: selectedRows.map((row) => row.department.id) });
                clearSelection();
              }}
            />
          )}
        </DataTable.SelectionBar>
        <div
          className="department-table-scroll w-full min-w-0 max-w-full overflow-x-auto [scrollbar-color:var(--line-strong)_transparent] focus-visible:outline-none focus-visible:shadow-[var(--ring-brand)]"
          role="region"
          aria-label="Departments table. Scroll horizontally to see all columns."
          tabIndex={0}
        >
          <DataTable.Table
            className="department-table min-w-[640px] table-fixed"
            containerClassName="overflow-visible"
          >
            <DataTable.Caption>Departments, groups, and calendar colors</DataTable.Caption>
            <DataTable.Header />
            <DataTable.Body emptyMessage="No departments yet. Create a department to get started." />
          </DataTable.Table>
        </div>
      </DataTable.Root>
      <p className="mt-1.5 hidden text-xs text-[var(--muted)] max-[767px]:block" aria-hidden="true">
        Scroll horizontally to see all columns.
      </p>

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
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Calendar color</span>
              <CellCombobox
                label="New department calendar color"
                value={[newDepartment.color]}
                options={colorOptions}
                displayValue={<DepartmentColorValue color={newDepartment.color} />}
                readOnly={busy}
                onValueChange={async ([color]) => {
                  if (color) setNewDepartment({ ...newDepartment, color: color as DepartmentColor });
                }}
              />
            </div>
            {error && <p className="m-0 text-sm text-[var(--danger-text)]" role="alert">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" disabled={busy} onClick={() => setNewDepartment(null)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={busy}>{busy ? "Saving…" : "Create department"}</Button>
            </div>
          </form>
        )}
      </Modal>
    </section>
  );
}
