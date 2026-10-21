import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useWorkspace } from "@moc/client";
import {
  Button,
  InlineEditCell,
  Modal,
  SegmentedControl,
} from "@moc/ui";
import type { Service, WorkspaceAction } from "@moc/shared";
import { ConfirmDialog } from "./components/UiDialogs";
import "./management.css";
import "./request-catalog.css";

type CatalogTab = "services" | "ministries";
type DeleteTarget =
  | { kind: "service"; service: Service }
  | { kind: "ministry"; name: string };

const serviceTabs = [
  { value: "services", label: "Services" },
  { value: "ministries", label: "Ministries" },
];

const serviceNameError = (name: string) =>
  name.trim() ? undefined : "Enter a service name.";

const ministryNameError = (name: string) =>
  name.trim() ? undefined : "Enter a ministry name.";

const tableCellClass =
  "border-b border-[var(--line-subtle)] px-2 py-1.5 align-middle text-sm leading-snug text-[var(--ink-secondary)]";
const tableHeaderClass =
  `${tableCellClass} sticky top-0 z-10 bg-[var(--surface)] text-xs font-semibold text-[var(--muted)] whitespace-nowrap`;

function cellSelect(
  label: string,
  value: string,
  onChange: (value: string) => void,
  options: { value: string; label: string }[],
  disabled: boolean,
) {
  return (
    <select
      className="input"
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export default function RequestCatalog() {
  const { state, user, act } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<CatalogTab>("services");
  const [newService, setNewService] = useState<Service | null>(null);
  const [newMinistry, setNewMinistry] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [tableOverflow, setTableOverflow] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const [tableWrapElement, setTableWrapElement] = useState<HTMLDivElement | null>(
    null,
  );
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const deleteFallbackRef = useRef<HTMLElement | null>(null);
  const pendingMinistryFocusRef = useRef<string | null>(null);
  const catalog = state.catalog;
  const departments = catalog.departments;

  useEffect(() => {
    if (!error) return;
    errorRef.current?.scrollIntoView({ block: "nearest" });
    errorRef.current?.focus({ preventScroll: true });
  }, [error]);

  useEffect(() => {
    const wrapper = tableWrapElement;
    if (!open || !wrapper) {
      setTableOverflow(false);
      return;
    }

    const updateOverflow = () =>
      setTableOverflow(wrapper.scrollWidth > wrapper.clientWidth + 1);
    updateOverflow();
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(wrapper);
    if (wrapper.firstElementChild) observer.observe(wrapper.firstElementChild);
    return () => observer.disconnect();
  }, [open, tab, tableWrapElement, catalog.services.length, catalog.ministries.length]);

  useEffect(() => {
    if (deleteTarget) return;
    const trigger = deleteTriggerRef.current;
    const fallback = deleteFallbackRef.current;
    deleteTriggerRef.current = null;
    deleteFallbackRef.current = null;
    const focusTarget = trigger?.isConnected ? trigger : fallback;
    if (!focusTarget?.isConnected) return;
    const frame = requestAnimationFrame(() => {
      if (focusTarget.isConnected) focusTarget.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [deleteTarget]);

  useLayoutEffect(() => {
    const nextName = pendingMinistryFocusRef.current;
    if (!nextName || busyKey) return;

    const button = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        ".request-catalog-table--ministries button[aria-label]",
      ),
    ).find(
      (candidate) =>
        candidate.getAttribute("aria-label") ===
        `Edit ${nextName} ministry name`,
    );
    if (!button) return;

    if (button.isConnected) {
      button.focus({ preventScroll: true });
      pendingMinistryFocusRef.current = null;
    }
  }, [busyKey, catalog.ministries]);

  if (!user?.approved || !user.isLeader) return null;

  async function mutate(action: WorkspaceAction, key: string) {
    setBusyKey(key);
    setError("");
    try {
      await act(action);
    } finally {
      setBusyKey("");
    }
  }

  async function mutateWithAlert(
    action: WorkspaceAction,
    key: string,
    onSuccess?: () => void,
  ) {
    setBusyKey(key);
    setError("");
    try {
      await act(action);
      onSuccess?.();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The change could not be saved.",
      );
    } finally {
      setBusyKey("");
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    if (deleteTarget.kind === "service") {
      await mutate(
        { type: "delete-service", serviceId: deleteTarget.service.id },
        `delete-service-${deleteTarget.service.id}`,
      );
      return;
    }

    await mutate(
      { type: "delete-ministry", name: deleteTarget.name },
      `delete-ministry-${deleteTarget.name}`,
    );
  }

  function changeTab(next: CatalogTab) {
    setTab(next);
    setNewService(null);
    setNewMinistry(null);
    setError("");
  }

  function beginNewService() {
    const department =
      departments.find((item) => item.id !== "cell-0") ?? departments[0];
    if (!department) return;
    setNewService({
      id: `service-${crypto.randomUUID()}`,
      name: "",
      department: department.id,
      subTeam: department.groups[0] ?? "",
    });
    setError("");
  }

  async function saveNewService(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newService) return;
    const department = departments.find(
      (item) => item.id === newService.department,
    );
    if (!newService.name.trim()) {
      setError("Enter a service name.");
      return;
    }
    if (!department || !department.groups.includes(newService.subTeam)) {
      setError("Choose a department and one of its groups.");
      return;
    }
    await mutateWithAlert(
      {
        type: "save-service",
        service: { ...newService, name: newService.name.trim() },
      },
      "create-service",
      () => setNewService(null),
    );
  }

  async function saveNewMinistry(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newMinistry === null) return;
    if (!newMinistry.trim()) {
      setError("Enter a ministry name.");
      return;
    }
    await mutateWithAlert(
      { type: "save-ministry", name: newMinistry.trim() },
      "create-ministry",
      () => setNewMinistry(null),
    );
  }

  async function saveServiceCell(item: Service, changes: Partial<Service>) {
    const current = catalog.services.find((service) => service.id === item.id);
    if (!current) return;
    await mutate(
      {
        type: "save-service",
        service: { ...current, ...changes },
      },
      `service-${item.id}`,
    );
  }

  const selectedDepartment = (id: string) =>
    departments.find((department) => department.id === id);

  return (
    <>
      <Button
        onClick={() => {
          setOpen(true);
          setError("");
        }}
      >
        <Plus size={16} /> Request options
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Request options"
        className="management-drawer request-catalog-drawer"
      >
        <div className="request-catalog flex min-w-0 flex-col gap-3">
          <SegmentedControl
            label="Request option type"
            value={tab}
            onValueChange={(value) => changeTab(value as CatalogTab)}
            options={serviceTabs}
          />
          {error && (
            <div
              className="management-error mb-0"
              role="alert"
              tabIndex={-1}
              ref={errorRef}
            >
              {error}
            </div>
          )}
          <div className="request-catalog-heading flex items-center justify-between gap-3">
            <h2 className="m-0 text-lg">{tab === "services" ? "Services" : "Ministries"}</h2>
            <Button
              variant="primary"
              className="max-[767px]:min-h-11"
              disabled={Boolean(busyKey) || (tab === "services" && !departments.length)}
              onClick={() =>
                tab === "services"
                  ? beginNewService()
                  : setNewMinistry("")
              }
            >
              <Plus size={16} />
              {tab === "services" ? "New service" : "New ministry"}
            </Button>
          </div>
          {tableOverflow && (
            <p className="request-catalog-scroll-hint block text-xs text-[var(--muted)]" aria-hidden="true">
              Scroll horizontally to view all columns.
            </p>
          )}
          {tab === "services" ? (
            <form className="min-w-0" onSubmit={saveNewService}>
              <div
                ref={setTableWrapElement}
                className="request-catalog-table-wrap relative max-w-full overflow-auto overscroll-contain border-y border-[var(--line)]"
                role="region"
                aria-label="Services table"
                tabIndex={0}
              >
                <table className="request-catalog-table w-full min-w-[760px] table-fixed border-collapse text-left">
                  <thead>
                    <tr>
                      <th className={`${tableHeaderClass} w-[27%]`} scope="col">Service</th>
                      <th className={`${tableHeaderClass} w-[21%]`} scope="col">Department</th>
                      <th className={`${tableHeaderClass} w-[21%]`} scope="col">Group</th>
                      <th className={`${tableHeaderClass} w-[18%]`} scope="col">Aired dates</th>
                      <th className={`${tableHeaderClass} w-[13%]`} scope="col">
                        <span className="visually-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {catalog.services.map((item) => {
                      const department = selectedDepartment(item.department);
                      const groupOptions = department?.groups ?? [];
                      const hasCurrentGroup = groupOptions.includes(item.subTeam);
                      return (
                        <tr key={item.id} className="hover:bg-[var(--surface-hover)]">
                          <th className={tableCellClass} scope="row">
                            <InlineEditCell
                              label={`${item.name} service name`}
                              value={item.name}
                              displayValue={item.name}
                              disabled={Boolean(busyKey)}
                              validate={serviceNameError}
                              onSave={(name) =>
                                saveServiceCell(item, { name: name.trim() })
                              }
                              renderEditor={({ value, onChange, disabled }) => (
                                <input
                                  className="input"
                                  aria-label={`Service name for ${item.name}`}
                                  value={value}
                                  maxLength={120}
                                  required
                                  disabled={disabled}
                                  onChange={(event) => onChange(event.target.value)}
                                />
                              )}
                            />
                          </th>
                          <td className={tableCellClass}>
                            <InlineEditCell
                              label={`${item.name} department`}
                              value={item.department}
                              displayValue={department?.name ?? item.department}
                              disabled={Boolean(busyKey)}
                              onSave={(departmentId) => {
                                const next = selectedDepartment(departmentId);
                                if (!next) return Promise.resolve();
                                return saveServiceCell(item, {
                                  department: next.id,
                                  subTeam: next.groups[0] ?? "",
                                });
                              }}
                              renderEditor={({ value, onChange, disabled }) =>
                                cellSelect(
                                  `Department for ${item.name}`,
                                  value,
                                  onChange,
                                  departments.map((entry) => ({
                                    value: entry.id,
                                    label: entry.name,
                                  })),
                                  disabled,
                                )
                              }
                            />
                          </td>
                          <td className={tableCellClass}>
                            <InlineEditCell
                              label={`${item.name} group`}
                              value={item.subTeam}
                              displayValue={item.subTeam || "Not assigned"}
                              disabled={Boolean(busyKey)}
                              validate={(group) =>
                                groupOptions.includes(group)
                                  ? undefined
                                  : "Choose a group in this department."
                              }
                              onSave={(subTeam) => saveServiceCell(item, { subTeam })}
                              renderEditor={({ value, onChange, disabled }) =>
                                cellSelect(
                                  `Group for ${item.name}`,
                                  hasCurrentGroup ? value : "",
                                  onChange,
                                  groupOptions.map((group) => ({
                                    value: group,
                                    label: group,
                                  })),
                                  disabled,
                                )
                              }
                            />
                          </td>
                          <td className={tableCellClass}>
                            <InlineEditCell
                              label={`${item.name} aired-date requirement`}
                              value={Boolean(item.requiresAiredDates)}
                              displayValue={item.requiresAiredDates ? "Required" : "Not required"}
                              disabled={Boolean(busyKey)}
                              onSave={(requiresAiredDates) =>
                                saveServiceCell(item, { requiresAiredDates })
                              }
                              renderEditor={({ value, onChange, disabled }) => (
                                <label className="request-catalog-checkbox">
                                  <input
                                    type="checkbox"
                                    aria-label={`Requires aired dates for ${item.name}`}
                                    checked={value}
                                    disabled={disabled}
                                    onChange={(event) => onChange(event.target.checked)}
                                  />
                                  Requires dates
                                </label>
                              )}
                            />
                          </td>
                          <td className={`${tableCellClass} request-catalog-actions`}>
                            <Button
                              size="sm"
                              variant="danger"
                              disabled={Boolean(busyKey)}
                              aria-label={`Delete ${item.name}`}
                              onClick={(event) => {
                                deleteTriggerRef.current = event.currentTarget;
                                const row = event.currentTarget.closest("tr");
                                deleteFallbackRef.current =
                                  row?.nextElementSibling?.querySelector<HTMLElement>(
                                    'button[aria-label^="Delete "]',
                                  ) ??
                                  row?.previousElementSibling?.querySelector<HTMLElement>(
                                    'button[aria-label^="Delete "]',
                                  ) ??
                                  event.currentTarget.closest<HTMLElement>(
                                    '[role="region"]',
                                  );
                                setDeleteTarget({ kind: "service", service: item });
                              }}
                            >
                              <Trash2 size={14} /> Delete
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                    {newService && (
                      <tr className="request-catalog-create-row bg-[var(--surface-sunken)]">
                        <th className={tableCellClass} scope="row">
                          <input
                              className="input"
                              aria-label="New service name"
                            autoFocus
                            value={newService.name}
                            maxLength={120}
                            required
                            disabled={Boolean(busyKey)}
                            onChange={(event) =>
                              setNewService({ ...newService, name: event.target.value })
                            }
                          />
                        </th>
                        <td className={tableCellClass}>
                          {cellSelect(
                            "New service department",
                            newService.department,
                            (departmentId) => {
                              const next = selectedDepartment(departmentId);
                              if (!next) return;
                              setNewService({
                                ...newService,
                                department: next.id,
                                subTeam: next.groups[0] ?? "",
                              });
                            },
                            departments.map((entry) => ({
                              value: entry.id,
                              label: entry.name,
                            })),
                            Boolean(busyKey),
                          )}
                        </td>
                        <td className={tableCellClass}>
                          {cellSelect(
                            "New service group",
                            newService.subTeam,
                            (subTeam) => setNewService({ ...newService, subTeam }),
                            (selectedDepartment(newService.department)?.groups ?? []).map(
                              (group) => ({ value: group, label: group }),
                            ),
                            Boolean(busyKey),
                          )}
                        </td>
                        <td className={tableCellClass}>
                          <label className="request-catalog-checkbox">
                            <input
                              type="checkbox"
                              aria-label="New service requires aired dates"
                              checked={Boolean(newService.requiresAiredDates)}
                              disabled={Boolean(busyKey)}
                              onChange={(event) =>
                                setNewService({
                                  ...newService,
                                  requiresAiredDates: event.target.checked,
                                })
                              }
                            />
                            Requires dates
                          </label>
                        </td>
                        <td className={`${tableCellClass} request-catalog-actions`}>
                          <Button
                            size="sm"
                            variant="primary"
                            type="submit"
                            disabled={Boolean(busyKey)}
                          >
                            {busyKey === "create-service" ? "Saving…" : "Save"}
                          </Button>
                          <Button
                            size="sm"
                            disabled={Boolean(busyKey)}
                            onClick={() => setNewService(null)}
                          >
                            Cancel
                          </Button>
                        </td>
                      </tr>
                    )}
                    {!catalog.services.length && !newService && (
                      <tr>
                        <td colSpan={5} className={`${tableCellClass} request-catalog-empty`}>
                          No services yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </form>
          ) : (
            <form className="min-w-0" onSubmit={saveNewMinistry}>
              <div
                ref={setTableWrapElement}
                className="request-catalog-table-wrap relative max-w-full overflow-auto overscroll-contain border-y border-[var(--line)]"
                role="region"
                aria-label="Ministries table"
                tabIndex={0}
              >
                <table className="request-catalog-table request-catalog-table--ministries w-full min-w-[450px] table-fixed border-collapse text-left">
                  <thead>
                    <tr>
                      <th className={`${tableHeaderClass} w-3/4`} scope="col">Ministry</th>
                      <th className={`${tableHeaderClass} w-1/4`} scope="col">
                        <span className="visually-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {catalog.ministries.map((name) => (
                      <tr key={name} className="hover:bg-[var(--surface-hover)]">
                        <th className={tableCellClass} scope="row">
                          <InlineEditCell
                            label={`${name} ministry name`}
                            value={name}
                            displayValue={name}
                            disabled={Boolean(busyKey)}
                            validate={ministryNameError}
                            onSave={async (nextName) => {
                              const trimmed = nextName.trim();
                              pendingMinistryFocusRef.current = trimmed;
                              tableWrapElement?.focus({ preventScroll: true });
                              try {
                                await mutate(
                                  {
                                    type: "save-ministry",
                                    name: trimmed,
                                    previousName: name,
                                  },
                                  `ministry-${name}`,
                                );
                              } catch (cause) {
                                pendingMinistryFocusRef.current = null;
                                throw cause;
                              }
                            }}
                            renderEditor={({ value, onChange, disabled }) => (
                              <input
                                  className="input"
                                aria-label={`Ministry name for ${name}`}
                                value={value}
                                maxLength={120}
                                required
                                disabled={disabled}
                                onChange={(event) => onChange(event.target.value)}
                              />
                            )}
                          />
                        </th>
                        <td className={`${tableCellClass} request-catalog-actions`}>
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={Boolean(busyKey)}
                            aria-label={`Delete ${name}`}
                            onClick={(event) => {
                              deleteTriggerRef.current = event.currentTarget;
                              const row = event.currentTarget.closest("tr");
                              deleteFallbackRef.current =
                                row?.nextElementSibling?.querySelector<HTMLElement>(
                                  'button[aria-label^="Delete "]',
                                ) ??
                                row?.previousElementSibling?.querySelector<HTMLElement>(
                                  'button[aria-label^="Delete "]',
                                ) ??
                                event.currentTarget.closest<HTMLElement>(
                                  '[role="region"]',
                                );
                              setDeleteTarget({ kind: "ministry", name });
                            }}
                          >
                            <Trash2 size={14} /> Delete
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {newMinistry !== null && (
                      <tr className="request-catalog-create-row bg-[var(--surface-sunken)]">
                        <th className={tableCellClass} scope="row">
                          <input
                            className="input"
                            aria-label="New ministry name"
                            autoFocus
                            value={newMinistry}
                            maxLength={120}
                            required
                            disabled={Boolean(busyKey)}
                            onChange={(event) => setNewMinistry(event.target.value)}
                          />
                        </th>
                        <td className={`${tableCellClass} request-catalog-actions`}>
                          <Button
                            size="sm"
                            variant="primary"
                            type="submit"
                            disabled={Boolean(busyKey)}
                          >
                            {busyKey === "create-ministry" ? "Saving…" : "Save"}
                          </Button>
                          <Button
                            size="sm"
                            disabled={Boolean(busyKey)}
                            onClick={() => setNewMinistry(null)}
                          >
                            Cancel
                          </Button>
                        </td>
                      </tr>
                    )}
                    {!catalog.ministries.length && newMinistry === null && (
                      <tr>
                        <td colSpan={2} className={`${tableCellClass} request-catalog-empty`}>
                          No ministries yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </form>
          )}
        </div>
      </Modal>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title={deleteTarget?.kind === "service" ? "Delete service?" : "Delete ministry?"}
        description={
          deleteTarget?.kind === "service"
            ? `Delete “${deleteTarget.service.name}”? Existing requests may use this service.`
            : `Delete “${deleteTarget?.name ?? ""}”? Existing requests may use this ministry.`
        }
        confirmLabel="Delete"
        onConfirm={confirmDelete}
      />
    </>
  );
}
