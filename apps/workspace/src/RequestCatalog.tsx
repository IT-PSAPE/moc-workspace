import { useEffect, useRef, useState, type RefObject } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { useWorkspace } from "@moc/client";
import {
  Badge,
  Button,
  CellCombobox,
  DataTable,
  EditableTextCell,
  Field,
  Modal,
  SegmentedControl,
  Switch,
  type DataTableColumnDef,
} from "@moc/ui";
import type { DepartmentDefinition, Service, WorkspaceAction } from "@moc/shared";
import { ConfirmDialog } from "./components/UiDialogs";

type ServiceRow = {
  service: Service;
  departments: DepartmentDefinition[];
  busyKey: string;
  onSave: (service: Service, changes: Partial<Service>, field: string) => Promise<void>;
  onToggle: (service: Service, enabled: boolean) => void;
};

type MinistryRow = {
  name: string;
  rowKey: string;
  enabled: boolean;
  busyKey: string;
  onRename: (previousName: string, name: string) => Promise<void>;
  onToggle: (name: string, enabled: boolean) => void;
};

const serviceColumns: DataTableColumnDef<ServiceRow>[] = [
  DataTable.createSelectionColumn<ServiceRow>({
    getLabel: ({ service }) => `Select request type ${service.name}`,
  }),
  {
    id: "name",
    header: "Request type",
    meta: { rowHeader: true, label: "Request type", headerClassName: "w-[28%]", className: "p-0" },
    cell: ({ row }) => {
      const { service, busyKey, onSave } = row.original;
      return <EditableTextCell
        label={`${service.name} request type name`}
        value={service.name}
        readOnly={Boolean(busyKey) && busyKey !== `service-${service.id}-name`}
        validate={(name) => name.trim() ? undefined : "Enter a request type name."}
        onSave={(name) => onSave(service, { name: name.trim() }, "name")}
      />;
    },
  },
  {
    id: "department",
    header: "Department",
    meta: { label: "Department", headerClassName: "w-[20%]", className: "p-0" },
    cell: ({ row }) => {
      const { service, departments, busyKey, onSave } = row.original;
      const department = departments.find((item) => item.id === service.department);
      return <CellCombobox
        label={`${service.name} department`}
        value={[service.department]}
        displayValue={<Badge color={department?.color}>{department?.name ?? service.department}</Badge>}
        readOnly={Boolean(busyKey) && busyKey !== `service-${service.id}-department`}
        options={departments.map((item) => ({ value: item.id, label: item.name }))}
        onValueChange={async ([departmentId]) => {
          const next = departments.find((item) => item.id === departmentId);
          if (!next?.groups.length) throw new Error("Choose a department with at least one group.");
          await onSave(service, { department: next.id, subTeam: next.groups[0] }, "department");
        }}
      />;
    },
  },
  {
    id: "group",
    header: "Group",
    meta: { label: "Group", headerClassName: "w-[20%]", className: "p-0" },
    cell: ({ row }) => {
      const { service, departments, busyKey, onSave } = row.original;
      const department = departments.find((item) => item.id === service.department);
      const groups = department?.groups ?? [];
      return <CellCombobox
        label={`${service.name} group`}
        value={service.subTeam ? [service.subTeam] : []}
        displayValue={service.subTeam ? <Badge color={department?.color}>{service.subTeam}</Badge> : "Not assigned"}
        readOnly={Boolean(busyKey) && busyKey !== `service-${service.id}-group`}
        options={groups.map((group) => ({ value: group, label: group }))}
        onValueChange={async ([subTeam]) => {
          if (!subTeam || !groups.includes(subTeam)) throw new Error("Choose a group in this department.");
          await onSave(service, { subTeam }, "group");
        }}
      />;
    },
  },
  {
    id: "airedDates",
    header: "Aired dates",
    meta: { label: "Aired dates", headerClassName: "w-[16%]", className: "p-0" },
    cell: ({ row }) => {
      const { service, busyKey, onSave } = row.original;
      return <CellCombobox
        label={`${service.name} aired-date requirement`}
        value={[service.requiresAiredDates ? "required" : "optional"]}
        readOnly={Boolean(busyKey) && busyKey !== `service-${service.id}-aired-dates`}
        options={[{ value: "required", label: "Required" }, { value: "optional", label: "Not required" }]}
        onValueChange={async ([value]) => onSave(service, { requiresAiredDates: value === "required" }, "aired-dates")}
      />;
    },
  },
  {
    id: "enabled",
    header: "Enabled",
    meta: { label: "Enabled", headerClassName: "w-[100px]" },
    cell: ({ row }) => {
      const { service, busyKey, onToggle } = row.original;
      return <Switch compact name={`${service.name} request type enabled`} checked={service.enabled !== false}
        disabled={Boolean(busyKey)} onChange={(enabled) => onToggle(service, enabled)} />;
    },
  },
];

const ministryColumns: DataTableColumnDef<MinistryRow>[] = [
  DataTable.createSelectionColumn<MinistryRow>({ getLabel: ({ name }) => `Select ministry ${name}` }),
  {
    id: "name",
    header: "Ministry",
    meta: { rowHeader: true, label: "Ministry", className: "p-0" },
    cell: ({ row }) => {
      const { name, busyKey, onRename } = row.original;
      return <EditableTextCell label={`${name} ministry name`} value={name}
        readOnly={Boolean(busyKey) && busyKey !== `ministry-${name}`}
        validate={(value) => value.trim() ? undefined : "Enter a ministry name."}
        onSave={(value) => onRename(name, value.trim())} />;
    },
  },
  {
    id: "enabled",
    header: "Enabled",
    meta: { label: "Enabled", headerClassName: "w-[100px]" },
    cell: ({ row }) => {
      const { name, enabled, busyKey, onToggle } = row.original;
      return <Switch compact name={`${name} ministry enabled`} checked={enabled}
        disabled={Boolean(busyKey)} onChange={(next) => onToggle(name, next)} />;
    },
  },
];

function CatalogDeleteAction({
  kind,
  names,
  busy,
  onDelete,
  fallbackFocus,
}: {
  kind: "request types" | "ministries";
  names: string[];
  busy: boolean;
  onDelete: () => Promise<void>;
  fallbackFocus: RefObject<HTMLButtonElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  return <>
    <Button ref={deleteButtonRef} type="button" size="sm" variant="danger" disabled={busy} onClick={() => setOpen(true)}>
      <Trash2 size={14} aria-hidden="true" /> Delete {kind}
    </Button>
    <ConfirmDialog
      open={open}
      onClose={() => setOpen(false)}
      title={`Delete ${kind}?`}
      description={`Delete ${names.length} selected ${kind}: ${names.join(", ")}. Items used by existing requests or tasks cannot be deleted. Switch them off instead to hide them from new public requests.`}
      confirmLabel={`Delete ${kind}`}
      onConfirm={onDelete}
      finalFocus={() => deleteButtonRef.current?.isConnected ? deleteButtonRef.current : fallbackFocus.current}
    />
  </>;
}

export default function RequestCatalog() {
  const { state, user, act } = useWorkspace();
  const [tab, setTab] = useState("request-types");
  const [newService, setNewService] = useState<Service | null>(null);
  const [newMinistry, setNewMinistry] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [retryOperation, setRetryOperation] = useState<(() => Promise<void>) | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const formErrorRef = useRef<HTMLParagraphElement>(null);
  const requestTypeNameRef = useRef<HTMLInputElement>(null);
  const ministryNameRef = useRef<HTMLInputElement>(null);
  const newRequestTypeButtonRef = useRef<HTMLButtonElement>(null);
  const newMinistryButtonRef = useRef<HTMLButtonElement>(null);
  const mutationInFlight = useRef(false);
  const ministryRowKeys = useRef(new Map<string, string>());
  const ministryRowSequence = useRef(0);
  const catalog = state.catalog;
  const departments = catalog.departments;
  const busy = Boolean(busyKey);
  const draftDepartment = departments.find((item) => item.id === newService?.department);

  useEffect(() => {
    if (!error) return;
    errorRef.current?.scrollIntoView({ block: "nearest" });
    errorRef.current?.focus({ preventScroll: true });
  }, [error]);
  useEffect(() => {
    if (formError) formErrorRef.current?.focus({ preventScroll: true });
  }, [formError]);

  async function mutate(action: WorkspaceAction, key: string) {
    if (mutationInFlight.current) throw new Error("Wait for the current change to finish.");
    mutationInFlight.current = true;
    setBusyKey(key);
    setError("");
    try {
      await act(action);
      setRetryOperation(null);
    } finally {
      mutationInFlight.current = false;
      setBusyKey("");
    }
  }

  async function toggle(action: WorkspaceAction, key: string) {
    const operation = () => mutate(action, key);
    try {
      await operation();
    } catch (cause) {
      setRetryOperation(() => operation);
      setError(cause instanceof Error ? cause.message : "The change could not be saved.");
    }
  }

  async function retry() {
    if (!retryOperation) return;
    try {
      await retryOperation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The change could not be saved.");
    }
  }

  async function saveService(service: Service, changes: Partial<Service>, field: string) {
    const current = catalog.services.find((item) => item.id === service.id);
    if (!current) throw new Error("This request type no longer exists.");
    await mutate({ type: "save-service", service: { ...current, ...changes } }, `service-${service.id}-${field}`);
  }

  function ministryRowKey(name: string) {
    const existing = ministryRowKeys.current.get(name);
    if (existing) return existing;
    const key = `ministry-row-${++ministryRowSequence.current}`;
    ministryRowKeys.current.set(name, key);
    return key;
  }

  async function renameMinistry(previousName: string, name: string) {
    // Keep the row (and the next focused cell) mounted when its string key changes.
    const key = ministryRowKey(previousName);
    const alias = name !== previousName && !catalog.ministries.includes(name);
    if (alias) ministryRowKeys.current.set(name, key);
    try {
      await mutate({ type: "save-ministry", name, previousName }, `ministry-${previousName}`);
      if (alias) ministryRowKeys.current.delete(previousName);
    } catch (cause) {
      if (alias && ministryRowKeys.current.get(name) === key) ministryRowKeys.current.delete(name);
      throw cause;
    }
  }

  function beginNewService() {
    const department = departments.find((item) => item.id !== "cell-0") ?? departments[0];
    if (!department) return;
    setFormError("");
    setNewService({ id: `service-${crypto.randomUUID()}`, name: "", department: department.id,
      subTeam: department.groups[0] ?? "", enabled: true });
  }

  async function createService(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newService || busy) return;
    setFormError("");
    if (!newService.name.trim()) { setFormError("Enter a request type name."); return; }
    if (!draftDepartment?.groups.includes(newService.subTeam)) { setFormError("Choose a department and one of its groups."); return; }
    try {
      await mutate({ type: "save-service", service: { ...newService, name: newService.name.trim() } }, "create-service");
      setNewService(null);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "The request type could not be created.");
    }
  }

  async function createMinistry(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newMinistry === null || busy) return;
    setFormError("");
    if (!newMinistry.trim()) { setFormError("Enter a ministry name."); return; }
    try {
      await mutate({ type: "save-ministry", name: newMinistry.trim() }, "create-ministry");
      setNewMinistry(null);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "The ministry could not be created.");
    }
  }

  if (!user?.approved || !user.isLeader) return null;

  const services: ServiceRow[] = catalog.services.map((service) => ({
    service, departments, busyKey, onSave: saveService,
    onToggle: (item, enabled) => void toggle({ type: "save-service", service: { ...item, enabled } }, `service-${item.id}-enabled`),
  }));
  const ministries: MinistryRow[] = catalog.ministries.map((name) => ({
    name, rowKey: ministryRowKey(name), enabled: !(catalog.disabledMinistries ?? []).includes(name), busyKey,
    onRename: renameMinistry,
    onToggle: (item, enabled) => void toggle({ type: "set-ministry-enabled", name: item, enabled }, `ministry-${item}-enabled`),
  }));

  return (
    <section className="flex min-w-0 flex-col gap-6" id="public-request" aria-labelledby="public-request-heading">
      <div>
        <h2 id="public-request-heading" className="m-0 text-lg font-semibold text-[var(--ink)]">Public request</h2>
        <p className="mb-0 mt-2 text-sm leading-6 text-[var(--muted)]">Manage the request types and ministries on the public form. Switching an item off hides it from new requests and keeps existing records.</p>
      </div>
      <div className="self-start">
        <SegmentedControl
          label="Public request options"
          value={tab}
          onValueChange={(next) => {
            if (mutationInFlight.current) return;
            setTab(next);
            setError("");
            setRetryOperation(null);
          }}
          options={[{ value: "request-types", label: "Request types", disabled: busy }, { value: "ministries", label: "Ministries", disabled: busy }]}
        />
      </div>
      {error && <div ref={errorRef} role="alert" tabIndex={-1} className="workflow-alert">
        <span>{error}</span>
        {retryOperation && <Button size="sm" disabled={busy} onClick={() => void retry()}><RefreshCw size={14} aria-hidden="true" /> {busy ? "Retrying…" : "Retry"}</Button>}
      </div>}
      {tab === "request-types" && <DataTable.Root key="request-types" columns={serviceColumns} data={services} getRowId={({ service }) => service.id} enableRowSelection={!busy}>
        <DataTable.Toolbar>
          <DataTable.Title>Request types</DataTable.Title>
          <DataTable.Actions><Button ref={newRequestTypeButtonRef} variant="primary" disabled={busy || !departments.length} onClick={beginNewService}><Plus size={16} aria-hidden="true" /> New request type</Button></DataTable.Actions>
        </DataTable.Toolbar>
        <DataTable.SelectionBar<ServiceRow> disabled={busy}>
          {({ selectedRows, clearSelection }) => <CatalogDeleteAction kind="request types" names={selectedRows.map(({ service }) => service.name)} busy={busy} fallbackFocus={newRequestTypeButtonRef}
            onDelete={async () => {
              await mutate({ type: "delete-services", serviceIds: selectedRows.map(({ service }) => service.id) }, "delete-services");
              clearSelection();
            }} />}
        </DataTable.SelectionBar>
        <DataTable.Table className="min-w-[900px]" containerClassName="overscroll-x-contain" aria-label="Request types table">
          <DataTable.Caption>Public request types</DataTable.Caption>
          <DataTable.Header />
          <DataTable.Body emptyMessage="No request types yet. Create a request type to add it to the public form." />
        </DataTable.Table>
      </DataTable.Root>}
      {tab === "ministries" && <DataTable.Root key="ministries" columns={ministryColumns} data={ministries} getRowId={({ rowKey }) => rowKey} enableRowSelection={!busy}>
        <DataTable.Toolbar>
          <DataTable.Title>Ministries</DataTable.Title>
          <DataTable.Actions><Button ref={newMinistryButtonRef} variant="primary" disabled={busy} onClick={() => { setFormError(""); setNewMinistry(""); }}><Plus size={16} aria-hidden="true" /> New ministry</Button></DataTable.Actions>
        </DataTable.Toolbar>
        <DataTable.SelectionBar<MinistryRow> disabled={busy}>
          {({ selectedRows, clearSelection }) => <CatalogDeleteAction kind="ministries" names={selectedRows.map(({ name }) => name)} busy={busy} fallbackFocus={newMinistryButtonRef}
            onDelete={async () => {
              await mutate({ type: "delete-ministries", names: selectedRows.map(({ name }) => name) }, "delete-ministries");
              clearSelection();
            }} />}
        </DataTable.SelectionBar>
        <DataTable.Table className="min-w-[360px]" aria-label="Ministries table">
          <DataTable.Caption>Public request ministries</DataTable.Caption>
          <DataTable.Header />
          <DataTable.Body emptyMessage="No ministries yet. Create a ministry to add it to the public form." />
        </DataTable.Table>
      </DataTable.Root>}
      <Modal open={Boolean(newService)} onClose={() => { if (!busy) setNewService(null); }} title="New request type" initialFocus={requestTypeNameRef}>
        {newService && <form className="flex flex-col gap-5" onSubmit={(event) => void createService(event)} aria-busy={busy || undefined}>
          <Field label="Request type name"><input ref={requestTypeNameRef} className="input" required maxLength={120} disabled={busy} aria-label="New request type name" value={newService.name} onChange={(event) => setNewService({ ...newService, name: event.target.value })} /></Field>
          <Field label="Department"><select className="input" aria-label="New request type department" value={newService.department} disabled={busy} onChange={(event) => {
            const department = departments.find((item) => item.id === event.target.value);
            if (department) setNewService({ ...newService, department: department.id, subTeam: department.groups[0] ?? "" });
          }}>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></Field>
          <Field label="Group"><select className="input" aria-label="New request type group" value={newService.subTeam} disabled={busy} onChange={(event) => setNewService({ ...newService, subTeam: event.target.value })}>{(draftDepartment?.groups ?? []).map((group) => <option key={group} value={group}>{group}</option>)}</select></Field>
          <Switch name="Requires aired dates" help="Ask for the original dates when this request type is selected." checked={Boolean(newService.requiresAiredDates)} disabled={busy} onChange={(requiresAiredDates) => setNewService({ ...newService, requiresAiredDates })} />
          {formError && <p ref={formErrorRef} tabIndex={-1} role="alert" className="m-0 text-sm leading-5 text-[var(--danger-text)]">{formError}</p>}
          <div className="flex flex-wrap justify-end gap-2"><Button type="button" disabled={busy} onClick={() => setNewService(null)}>Cancel</Button><Button type="submit" variant="primary" disabled={busy}>{busy ? "Creating…" : "Create request type"}</Button></div>
        </form>}
      </Modal>
      <Modal open={newMinistry !== null} onClose={() => { if (!busy) setNewMinistry(null); }} title="New ministry" initialFocus={ministryNameRef}>
        <form className="flex flex-col gap-5" onSubmit={(event) => void createMinistry(event)} aria-busy={busy || undefined}>
          <Field label="Ministry name"><input ref={ministryNameRef} className="input" required maxLength={120} disabled={busy} aria-label="New ministry name" value={newMinistry ?? ""} onChange={(event) => setNewMinistry(event.target.value)} /></Field>
          {formError && <p ref={formErrorRef} tabIndex={-1} role="alert" className="m-0 text-sm leading-5 text-[var(--danger-text)]">{formError}</p>}
          <div className="flex flex-wrap justify-end gap-2"><Button type="button" disabled={busy} onClick={() => setNewMinistry(null)}>Cancel</Button><Button type="submit" variant="primary" disabled={busy}>{busy ? "Creating…" : "Create ministry"}</Button></div>
        </form>
      </Modal>
    </section>
  );
}
