import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  Circle,
  Clock3,
  GripVertical,
  LockKeyhole,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Badge, Button, Field, Modal } from "@moc/ui";
import {
  DEPARTMENTS,
  SERVICES,
  type Department as DepartmentId,
  type Priority,
  type Progress,
  type SubTeam,
  type Task,
  type TaskStatus,
} from "@moc/shared";
import { useWorkspace } from "@moc/client";
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
const priorityTone: Record<Priority, "neutral" | "gold" | "red" | "green"> = {
  low: "neutral",
  medium: "green",
  high: "gold",
  urgent: "red",
};
const progressSteps: Progress[] = [0, 25, 50, 75, 100];
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
  const departmentInfo = DEPARTMENTS.find((item) => item.id === department)!;
  const isCell0 = user?.department === "cell-0";
  const canEdit = Boolean(
    user?.approved && (isCell0 || user?.department === department),
  );
  const [search, setSearch] = useState("");
  const [teamFilter, setTeamFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [note, setNote] = useState("");
  const [form, setForm] = useState({
    title: "",
    subTeam: departmentInfo.groups[0] as SubTeam,
    priority: "medium" as Priority,
    dueAt: "",
    instructions: "",
    notes: "",
  });

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
          (statusFilter === "all" || task.status === statusFilter) &&
          (priorityFilter === "all" || task.priority === priorityFilter)
        );
      }),
    [tasks, search, teamFilter, statusFilter, priorityFilter],
  );
  const taskService = (task: Task) =>
    SERVICES.find((service) => service.id === task.service)?.name ??
    task.service;
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
    change: { progress?: Progress; status?: TaskStatus; priority?: Priority },
  ) => run(() => act({ type: "update-task", taskId: task.id, ...change }));
  const handleDrop = (event: React.DragEvent, status: TaskStatus) => {
    event.preventDefault();
    const taskId = event.dataTransfer.getData("text/task");
    const task = tasks.find((item) => item.id === taskId);
    if (task && canEdit && task.status !== status) {
      const progress =
        status === "completed"
          ? 100
          : status === "pending"
            ? 0
            : task.progress === 0
              ? 25
              : task.progress === 100
                ? 75
                : task.progress;
      void updateTask(task, { status, progress });
    }
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
  const addPrivateNote = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || !note.trim()) return;
    await run(async () => {
      await act({ type: "add-note", taskId: selected.id, text: note });
      setNote("");
    });
  };

  if (loading)
    return (
      <div className="workspace-page">
        <div className="workflow-skeleton" />
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
  if (!isCell0 && department === "cell-0")
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
        {isCell0 && (
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
        <div className="workflow-search">
          <Search size={17} />
          <input
            aria-label="Search tasks"
            placeholder="Search tasks, ministries…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="workflow-filters">
          <SlidersHorizontal size={16} />
          <select
            aria-label="Filter by group"
            value={teamFilter}
            onChange={(event) => setTeamFilter(event.target.value)}
          >
            <option value="all">All groups</option>
            {departmentInfo.groups.map((group) => (
              <option key={group}>{group}</option>
            ))}
          </select>
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
          <select
            aria-label="Filter by priority"
            value={priorityFilter}
            onChange={(event) => setPriorityFilter(event.target.value)}
          >
            <option value="all">All priorities</option>
            {(["urgent", "high", "medium", "low"] as Priority[]).map(
              (priority) => (
                <option key={priority} value={priority}>
                  {priority[0].toUpperCase() + priority.slice(1)} priority
                </option>
              ),
            )}
          </select>
        </div>
      </div>
      {(error || feedback) && (
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
          return (
            <section
              className="kanban-column"
              key={column.id}
              onDragOver={(event) => {
                if (canEdit) event.preventDefault();
              }}
              onDrop={(event) => handleDrop(event, column.id)}
            >
              <div className="kanban-column-heading">
                <div>
                  <span className={"status-dot status-" + column.id} />
                  <h2>{column.label}</h2>
                  <span className="column-count">{items.length}</span>
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
                {items.map((task) => (
                  <article
                    key={task.id}
                    className={
                      "task-card " + (canEdit ? "task-card-draggable" : "")
                    }
                    draggable={canEdit}
                    onDragStart={(event) => {
                      event.dataTransfer.setData("text/task", task.id);
                      event.dataTransfer.effectAllowed = "move";
                    }}
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
                        setNote("");
                        setFeedback("");
                        void refresh();
                      }}
                      aria-label={"Open " + task.title}
                    >
                      <div className="task-card-top">
                        <Badge tone={priorityTone[task.priority]}>
                          {task.priority}
                        </Badge>
                        <span className="task-reference">
                          {task.requestId
                            ? (state?.requests.find(
                                (request) => request.id === task.requestId,
                              )?.reference ?? "Request")
                            : "Internal"}
                        </span>
                      </div>
                      <h3>{task.title}</h3>
                      {taskService(task).toLowerCase() !==
                        task.subTeam.toLowerCase() && (
                        <p className="task-card-service">{taskService(task)}</p>
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
                      <div className="task-progress-row">
                        <div className="progress-track">
                          <span style={{ width: task.progress + "%" }} />
                        </div>
                        <span>{task.progress}%</span>
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
                        <span>
                          <ArrowUpRight size={14} /> Details
                        </span>
                      </div>
                    </button>
                  </article>
                ))}
                {items.length === 0 && (
                  <div className="kanban-empty">
                    <Circle size={16} />
                    <span>
                      {search ||
                      teamFilter !== "all" ||
                      statusFilter !== "all" ||
                      priorityFilter !== "all"
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

      <Modal
        open={Boolean(selectedId)}
        onClose={() => setSelectedId(null)}
        title="Task details"
      >
        {selected && (
          <div className="workflow-detail">
            <div className="detail-title-row">
              <div>
                <div className="eyebrow">
                  {selected.requestId
                    ? (state?.requests.find(
                        (request) => request.id === selected.requestId,
                      )?.reference ?? "Ministry request")
                    : "Internal task"}
                </div>
                <h2>{selected.title}</h2>
              </div>
              <Badge tone={priorityTone[selected.priority]}>
                {selected.priority} priority
              </Badge>
            </div>
            <div className="detail-grid">
              <div>
                <span>Ministry</span>
                <strong>{selected.ministry || "Cell 0"}</strong>
              </div>
              <div>
                <span>Service</span>
                <strong>{taskService(selected)}</strong>
              </div>
              <div>
                <span>Group</span>
                <strong>{selected.subTeam}</strong>
              </div>
              <div>
                <span>Due date</span>
                <strong>
                  {new Intl.DateTimeFormat("en-ZA", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(selected.dueAt))}
                </strong>
              </div>
            </div>
            <div className="detail-copy">
              <span>Instructions</span>
              <p>{selected.instructions}</p>
            </div>
            <div className="detail-copy">
              <span>Notes</span>
              <p>{selected.notes}</p>
            </div>
            {canEdit && (
              <div className="detail-edit">
                <div className="detail-section-heading">
                  <div>
                    <h3>Progress</h3>
                    <p>Choose the current completion level.</p>
                  </div>
                  <strong>{selected.progress}%</strong>
                </div>
                <div className="progress-buttons" aria-label="Update progress">
                  {progressSteps.map((step) => (
                    <button
                      key={step}
                      className={
                        selected.progress === step
                          ? "progress-choice active"
                          : "progress-choice"
                      }
                      disabled={busy}
                      onClick={() =>
                        void updateTask(selected, { progress: step })
                      }
                    >
                      {selected.progress === step && <Check size={14} />}
                      {step}%
                    </button>
                  ))}
                </div>
                {canEdit && (
                  <Field label="Priority">
                    <select
                      value={selected.priority}
                      disabled={busy}
                      onChange={(event) =>
                        void updateTask(selected, {
                          priority: event.target.value as Priority,
                        })
                      }
                    >
                      {(["low", "medium", "high", "urgent"] as Priority[]).map(
                        (item) => (
                          <option key={item} value={item}>
                            {item[0].toUpperCase() + item.slice(1)}
                          </option>
                        ),
                      )}
                    </select>
                  </Field>
                )}
                <div className="detail-actions">
                  <Button
                    disabled={busy || selected.status === "pending"}
                    onClick={() =>
                      void updateTask(selected, {
                        status: "pending",
                        progress: 0,
                      })
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
                      void updateTask(selected, {
                        status: "completed",
                        progress: 100,
                      })
                    }
                  >
                    <Check size={15} /> Complete
                  </Button>
                </div>
              </div>
            )}
            {canEdit && (
              <section className="private-notes">
                <div className="detail-section-heading">
                  <div>
                    <h3>Private team notes</h3>
                    <p>Visible to Cell 0 and this department’s leaders only.</p>
                  </div>
                  <LockKeyhole size={16} />
                </div>
                {selected.privateNotes.length > 0 ? (
                  <div className="private-note-list">
                    {selected.privateNotes.map((item) => (
                      <div className="private-note" key={item.id}>
                        <p>{item.text}</p>
                        <span>
                          {item.author} · {dateLabel(item.createdAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted-copy">No private notes yet.</p>
                )}
                <form className="inline-note-form" onSubmit={addPrivateNote}>
                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Add a private note…"
                    rows={2}
                  />
                  <Button
                    type="submit"
                    variant="secondary"
                    disabled={busy || !note.trim()}
                  >
                    Add note
                  </Button>
                </form>
              </section>
            )}
            {(feedback || error) && (
              <div className="workflow-alert" role="alert">
                {feedback || error}
              </div>
            )}
          </div>
        )}
      </Modal>
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
          <div className="form-row">
            <Field label="Group">
              <select
                value={form.subTeam}
                onChange={(event) =>
                  setForm({ ...form, subTeam: event.target.value as SubTeam })
                }
              >
                {departmentInfo.groups.map((group) => (
                  <option key={group}>{group}</option>
                ))}
              </select>
            </Field>
            <Field label="Priority">
              <select
                value={form.priority}
                onChange={(event) =>
                  setForm({ ...form, priority: event.target.value as Priority })
                }
              >
                {(["low", "medium", "high", "urgent"] as Priority[]).map(
                  (priority) => (
                    <option key={priority} value={priority}>
                      {priority[0].toUpperCase() + priority.slice(1)}
                    </option>
                  ),
                )}
              </select>
            </Field>
          </div>
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
            <div className="workflow-alert" role="alert">
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
