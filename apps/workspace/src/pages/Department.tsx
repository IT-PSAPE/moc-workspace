import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  Circle,
  Clock3,
  GripVertical,
  LockKeyhole,
  Plus,
  Search,
  X,
} from "lucide-react";
import { Button, Field, Modal } from "@moc/ui";
import { FilterDrawer } from "../components/UiDialogs";
import DetailsDrawer from "../components/DetailsDrawer";
import {
  type Department as DepartmentId,
  type SubTeam,
  type Task,
  type TaskStatus,
} from "@moc/shared";
import { useWorkspace } from "@moc/client";
import TaskDetails from "../TaskDetails";
import "./workflows.css";

const columns: {
  id: TaskStatus;
  label: string;
  tone: "gold" | "green" | "neutral";
}[] = [
  { id: "pending", label: "Pending", tone: "gold" },
  { id: "in-progress", label: "In progress", tone: "green" },
  { id: "completed", label: "Completed", tone: "neutral" },
];
const dateLabel = (value: string) =>
  new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
const toLocalInput = (date: Date) => {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
};

export default function DepartmentPage({
  department,
}: {
  department: DepartmentId;
}) {
  const { state, user, loading, error, act, refresh } = useWorkspace();
  const departmentInfo = state.catalog?.departments.find(
    (item) => item.id === department,
  );
  const departmentGroups = departmentInfo?.groups ?? [];
  const isCell0 = user?.department === "cell-0";
  const isCell0Leader = Boolean(isCell0 && user?.isLeader);
  const canEdit = Boolean(
    user?.approved && (isCell0Leader || user?.department === department),
  );
  const [search, setSearch] = useState("");
  const [teamFilter, setTeamFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const actionFeedbackRef = useRef<HTMLDivElement>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dropTargetStatus, setDropTargetStatus] = useState<TaskStatus | null>(
    null,
  );
  const [form, setForm] = useState({
    title: "",
    subTeam: "" as SubTeam,
    dueAt: "",
    instructions: "",
    notes: "",
  });

  useEffect(() => {
    const nextGroup = departmentGroups.includes(form.subTeam)
      ? form.subTeam
      : departmentGroups[0] ?? "";
    if (nextGroup !== form.subTeam)
      setForm((current) => ({ ...current, subTeam: nextGroup }));
  }, [departmentGroups, form.subTeam]);

  const tasks = useMemo(
    () => (state?.tasks ?? []).filter((task) => task.department === department),
    [state, department],
  );
  const selected = useMemo(
    () => tasks.find((task) => task.id === selectedId) ?? null,
    [tasks, selectedId],
  );
  const filtered = useMemo(
    () =>
      tasks.filter((task) => {
        const matchesSearch = (task.title + " " + task.ministry)
          .toLowerCase()
          .includes(search.toLowerCase());
        return (
          matchesSearch &&
          (teamFilter === "all" || task.subTeam === teamFilter) &&
          (statusFilter === "all" || task.status === statusFilter)
        );
      }),
    [tasks, search, teamFilter, statusFilter],
  );
  useEffect(() => {
    if (!feedback && !error) return;
    const alert = actionFeedbackRef.current;
    if (!alert) return;
    alert.scrollIntoView({ block: "nearest" });
    alert.focus({ preventScroll: true });
  }, [error, feedback, createOpen, selectedId]);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setFeedback("");
    try {
      await operation();
      setSelectedId(null);
    } catch (cause) {
      setFeedback(
        cause instanceof Error
          ? cause.message
          : "The change could not be saved. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const updateTask = (
    task: Task,
    change: { status: TaskStatus },
  ) => run(() => act({ type: "update-task", taskId: task.id, ...change }));
  const matchesDropFilters = (task: Task) =>
    (task.title + " " + task.ministry)
      .toLowerCase()
      .includes(search.toLowerCase()) &&
    (teamFilter === "all" || task.subTeam === teamFilter);
  const handleDragOver = (event: React.DragEvent, status: TaskStatus) => {
    const task = draggingTaskId
      ? tasks.find((item) => item.id === draggingTaskId)
      : undefined;
    if (!canEdit || !task || task.status === status) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTargetStatus(status);
  };
  const handleDragLeave = (
    event: React.DragEvent,
    status: TaskStatus,
  ) => {
    const nextTarget = event.relatedTarget;
    if (
      dropTargetStatus === status &&
      !(nextTarget instanceof Node && event.currentTarget.contains(nextTarget))
    )
      setDropTargetStatus(null);
  };
  const handleDrop = (event: React.DragEvent, status: TaskStatus) => {
    event.preventDefault();
    const taskId = event.dataTransfer.getData("text/task");
    const task = tasks.find((item) => item.id === taskId);
    setDraggingTaskId(null);
    setDropTargetStatus(null);
    if (task && canEdit && task.status !== status) {
      void updateTask(task, { status });
    }
  };
  const resetDrag = () => {
    setDraggingTaskId(null);
    setDropTargetStatus(null);
  };
  const createTask = async (event: React.FormEvent) => {
    event.preventDefault();
    await run(async () => {
      await act({
        type: "create-task",
        input: {
          ...form,
          department,
          dueAt: new Date(form.dueAt).toISOString(),
        },
      });
      setCreateOpen(false);
    });
  };

  if (loading)
    return (
      <div className="workspace-page">
        <div className="workflow-skeleton" />
      </div>
    );
  if (!departmentInfo)
    return (
      <div className="workspace-page">
        <section className="workflow-empty">
          <Circle />
          <h2>Department not found</h2>
          <p>This department is no longer in the workspace catalog.</p>
          <a className="button button-secondary" href="/departments">
            View departments
          </a>
        </section>
      </div>
    );
  if (!user?.approved)
    return (
      <div className="workspace-page">
        <section className="workflow-empty">
          <LockKeyhole />
          <h2>Department access required</h2>
          <p>
            Sign in with an approved Cell 0 or {departmentInfo.name} leader
            account to view this team’s work.
          </p>
        </section>
      </div>
    );
  if (!isCell0Leader && department === "cell-0")
    return (
      <div className="workspace-page">
        <section className="workflow-empty">
          <LockKeyhole />
          <h2>This department is private</h2>
          <p>Cell 0 work is visible only to Cell 0 leaders.</p>
        </section>
      </div>
    );

  return (
    <div className="workspace-page workflow-page">
      <div className="page-header workflow-header">
        <div className="page-heading">
          <h1>{departmentInfo.name}</h1>
        </div>
        {isCell0Leader && (
          <Button
            variant="primary"
            onClick={() => {
              setFeedback("");
              setCreateOpen(true);
            }}
          >
            <Plus size={16} /> New internal task
          </Button>
        )}
      </div>
      <div className="workflow-toolbar">
        <div className="workflow-search w-[min(60vw,320px)] !basis-auto !flex-none !min-w-0">
          <Search size={17} />
          <input
            aria-label="Search tasks"
            placeholder="Search tasks, ministries…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <FilterDrawer
          activeCount={Number(teamFilter !== "all") + Number(statusFilter !== "all")}
          onReset={() => {
            setTeamFilter("all");
            setStatusFilter("all");
            window.requestAnimationFrame(() => {
              document
                .querySelector<HTMLButtonElement>(
                  '[role="dialog"] button[aria-label="Close dialog"]',
                )
                ?.focus();
            });
          }}
        >
          <Field label="Group">
            <select
              aria-label="Filter by group"
              value={teamFilter}
              onChange={(event) => setTeamFilter(event.target.value)}
            >
              <option value="all">All groups</option>
              {departmentGroups.map((group) => (
                <option key={group}>{group}</option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="all">All statuses</option>
              {columns.map((column) => (
                <option key={column.id} value={column.id}>
                  {column.label}
                </option>
              ))}
            </select>
          </Field>
        </FilterDrawer>
      </div>
      {(error || feedback) && !selectedId && !createOpen && (
        <div className="workflow-alert" role="alert">
          <span>{feedback || error}</span>
          <button onClick={() => setFeedback("")} aria-label="Dismiss">
            <X size={15} />
          </button>
        </div>
      )}
      <section
        className="kanban-board"
        aria-label={departmentInfo.name + " task board"}
      >
        {columns.map((column) => {
          const items = filtered.filter((task) => task.status === column.id);
          const movingTask = draggingTaskId
            ? tasks.find((task) => task.id === draggingTaskId)
            : undefined;
          const showDropPlaceholder = Boolean(
            canEdit &&
              movingTask &&
              movingTask.status !== column.id &&
              dropTargetStatus === column.id,
          );
          const previewItems = movingTask
            ? tasks.filter(
                (task) =>
                  matchesDropFilters(task) &&
                  (task.id === movingTask.id || task.status === column.id),
              )
            : [];
          const insertionIndex =
            statusFilter === "all"
              ? previewItems.findIndex((task) => task.id === draggingTaskId)
              : 0;
          const dropDescription =
            statusFilter !== "all" && statusFilter !== column.id
              ? `Move to ${column.label}; it will leave this status filter.`
              : `Move to ${column.label}.`;
          return (
            <section
              className={
                "kanban-column" +
                (showDropPlaceholder ? " kanban-column-drop-target" : "")
              }
              key={column.id}
              onDragOver={(event) => handleDragOver(event, column.id)}
              onDragLeave={(event) => handleDragLeave(event, column.id)}
              onDrop={(event) => handleDrop(event, column.id)}
            >
              <div className="kanban-column-heading">
                <div>
                  <span className={"status-dot status-" + column.id} />
                  <h2>{column.label}</h2>
                </div>
                {column.id === "pending" && isCell0 && (
                  <button
                    className="icon-button quiet"
                    aria-label="Create task"
                    onClick={() => setCreateOpen(true)}
                  >
                    <Plus size={17} />
                  </button>
                )}
              </div>
              <div className="kanban-card-list">
                {items.map((task, index) => (
                  <Fragment key={task.id}>
                    {showDropPlaceholder &&
                      statusFilter === "all" &&
                      insertionIndex === index && (
                        <div
                          className="kanban-drop-placeholder"
                          aria-hidden="true"
                        >
                          {dropDescription}
                        </div>
                      )}
                    <article
                      className={
                        "task-card " + (canEdit ? "task-card-draggable" : "")
                      }
                      draggable={canEdit}
                      onDragStart={(event) => {
                        event.dataTransfer.setData("text/task", task.id);
                        event.dataTransfer.effectAllowed = "move";
                        setDraggingTaskId(task.id);
                      }}
                      onDragEnd={resetDrag}
                    >
                      {canEdit && (
                        <span className="task-grip" aria-hidden="true">
                          <GripVertical size={15} />
                        </span>
                      )}
                      <button
                        className="task-card-open"
                        onClick={() => {
                          setSelectedId(task.id);
                          setFeedback("");
                          void refresh();
                        }}
                        aria-label={"Open " + task.title}
                      >
                        <h3>{task.title}</h3>
                        {task.requestId && (
                          <span className="task-reference">
                            {state?.requests.find(
                              (request) => request.id === task.requestId,
                            )?.reference ?? "Request"}
                          </span>
                        )}
                        <div className="task-card-meta">
                          {task.subTeam !== departmentInfo.name && (
                            <>
                              <span>{task.subTeam}</span>
                              <span>·</span>
                            </>
                          )}
                          <span>{task.ministry || "Cell 0"}</span>
                        </div>
                        <div className="task-card-footer">
                          <span
                            className={
                              new Date(task.dueAt).getTime() < Date.now() &&
                              task.status !== "completed"
                                ? "overdue"
                                : ""
                            }
                          >
                            <CalendarDays size={14} />
                            {dateLabel(task.dueAt)}
                          </span>
                        </div>
                      </button>
                    </article>
                  </Fragment>
                ))}
                {showDropPlaceholder &&
                  (statusFilter !== "all" || insertionIndex >= items.length) && (
                    <div className="kanban-drop-placeholder" aria-hidden="true">
                      {dropDescription}
                    </div>
                  )}
                {items.length === 0 && !showDropPlaceholder && (
                  <div className="kanban-empty">
                    <Circle size={16} />
                    <span>
                      {search ||
                      teamFilter !== "all" ||
                      statusFilter !== "all"
                        ? "No tasks match these filters."
                        : "Nothing here yet."}
                    </span>
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </section>

      <DetailsDrawer
        open={Boolean(selectedId)}
        onClose={() => setSelectedId(null)}
        title="Task details"
      >
        {selected && (
          <div className="workflow-detail">
            <TaskDetails key={selected.id} task={selected}>
              {canEdit ? (
                <div className="detail-edit">
                  <div className="detail-section-heading">
                    <h3>Status</h3>
                  </div>
                  <div className="detail-actions">
                    <Button
                      disabled={busy || selected.status === "pending"}
                      onClick={() =>
                        void updateTask(selected, { status: "pending" })
                      }
                    >
                      Move to pending
                    </Button>
                    <Button
                      disabled={busy || selected.status === "in-progress"}
                      onClick={() =>
                        void updateTask(selected, { status: "in-progress" })
                      }
                    >
                      <Clock3 size={15} /> In progress
                    </Button>
                    <Button
                      variant="primary"
                      disabled={busy || selected.status === "completed"}
                      onClick={() =>
                        void updateTask(selected, { status: "completed" })
                      }
                    >
                      <Check size={15} /> Complete
                    </Button>
                  </div>
                </div>
              ) : (
                <></>
              )}
            </TaskDetails>
            {(feedback || error) && (
              <div
                ref={actionFeedbackRef}
                className="workflow-alert"
                role="alert"
                tabIndex={-1}
              >
                {feedback || error}
              </div>
            )}
          </div>
        )}
      </DetailsDrawer>
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create internal task"
      >
        <form className="workflow-form" onSubmit={createTask}>
          <p className="form-intro">
            Add private work for a production team. Cell 0 will be able to track
            and update this task.
          </p>
          <Field label="Task title">
            <input
              required
              maxLength={160}
              value={form.title}
              onChange={(event) =>
                setForm({ ...form, title: event.target.value })
              }
              placeholder="e.g. Prepare Sunday service graphics"
            />
          </Field>
          <Field label="Group">
            <select
              value={form.subTeam}
              onChange={(event) =>
                setForm({ ...form, subTeam: event.target.value as SubTeam })
              }
            >
              {departmentGroups.map((group) => (
                <option key={group}>{group}</option>
              ))}
            </select>
          </Field>
          <Field label="Due date and time">
            <input
              type="datetime-local"
              required
              min={toLocalInput(new Date())}
              value={form.dueAt}
              onChange={(event) =>
                setForm({ ...form, dueAt: event.target.value })
              }
            />
          </Field>
          <Field label="Instructions">
            <textarea
              required
              rows={3}
              value={form.instructions}
              onChange={(event) =>
                setForm({ ...form, instructions: event.target.value })
              }
              placeholder="What needs to be delivered?"
            />
          </Field>
          <Field label="Notes">
            <textarea
              required
              rows={3}
              value={form.notes}
              onChange={(event) =>
                setForm({ ...form, notes: event.target.value })
              }
              placeholder="Context and coordination details"
            />
          </Field>
          {(feedback || error) && (
            <div
              ref={actionFeedbackRef}
              className="workflow-alert"
              role="alert"
              tabIndex={-1}
            >
              {feedback || error}
            </div>
          )}
          <div className="form-actions">
            <Button type="button" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Creating…" : "Create task"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
