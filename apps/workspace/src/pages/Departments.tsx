import { useCallback, useMemo, useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { ArrowRight, Filter, Search } from "lucide-react";
import type { TaskStatus } from "@moc/shared";
import { useWorkspace } from "@moc/client";
import { Button, DataTable, Field } from "@moc/ui";
import { FilterDrawer } from "../components/UiDialogs";
import DetailsDrawer from "../components/DetailsDrawer";
import { createWorkColumns, type WorkTableRow } from "../components/WorkTable";
import TaskDetails from "../TaskDetails";
import "./workflows.css";

const statusLabels: Record<TaskStatus, string> = {
  pending: "Pending",
  "in-progress": "In progress",
  completed: "Completed",
};
const statusTone = (status: TaskStatus) =>
  status === "completed"
    ? "green"
    : status === "in-progress"
      ? "gold"
      : "neutral";
const taskColumns = createWorkColumns<WorkTableRow>();
const getTaskRowId = (row: WorkTableRow) => row.id;

export default function Departments() {
  const { state, user } = useWorkspace();
  const location = useLocation();
  const routeId = location.pathname.split("/").filter(Boolean)[1];
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const showTask = useCallback((id: string) => setSelectedTaskId(id), []);
  const allDepartments = state.catalog.departments.filter(
    (department) => user?.department === "cell-0" || department.id !== "cell-0",
  );
  const selected = allDepartments.find(
    (department) => department.id === routeId,
  );
  const allTasks = state?.tasks ?? [];
  const servicesById = useMemo(
    () => new Map(state.catalog.services.map((service) => [service.id, service.name])),
    [state.catalog.services],
  );
  const visibleTasks = useMemo(
    () =>
      allTasks.filter(
        (task) =>
          (!selected || task.department === selected.id) &&
          (!query.trim() ||
            `${task.title} ${task.ministry} ${servicesById.get(task.service) ?? task.service} ${task.subTeam}`
              .toLowerCase()
              .includes(query.toLowerCase())) &&
          (filter === "all" || task.status === filter),
      ),
    [allTasks, selected, query, filter, servicesById],
  );
  const currentDepartments = selected ? [selected] : allDepartments;

  const departmentsById = useMemo(
    () =>
      new Map(
        state.catalog.departments.map((department) => [
          department.id,
          department,
        ]),
      ),
    [state.catalog.departments],
  );
  const selectedTask = allTasks.find((task) => task.id === selectedTaskId) ?? null;
  const tableRows = useMemo<WorkTableRow[]>(
    () =>
      visibleTasks
        .slice()
        .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
        .map((task) => {
          const department = departmentsById.get(task.department);
          return {
            id: task.id,
            title: task.title,
            ministry: task.ministry || "Cell 0",
            dueAt: task.dueAt,
            groupName: task.subTeam,
            statusLabel: statusLabels[task.status],
            statusTone: statusTone(task.status),
            onOpen: () => showTask(task.id),
            serviceName: servicesById.get(task.service) ?? task.service,
            departmentName: department?.name ?? "Department unavailable",
            departmentColor: department?.color,
          };
        }),
    [visibleTasks, departmentsById, servicesById, showTask],
  );

  return (
    <div className="departments-page">
      <div className="page-heading">
        <div>
          <h1>{selected ? selected.name : "Departments"}</h1>
        </div>
      </div>
      {!selected && (
        <div className="department-overview-grid">
          {currentDepartments.map((department) => {
            const tasks = allTasks.filter(
              (task) => task.department === department.id,
            );
            const complete = tasks.filter(
              (task) => task.status === "completed",
            ).length;
            const active = tasks.filter(
              (task) => task.status !== "completed",
            ).length;
            return (
              <a
                className="overview-card"
                data-department-color={department.color}
                key={department.id}
                href={`/departments/${department.id}`}
              >
                <div className="overview-card-top">
                  <span className="overview-mark">
                    {department.name === "Visual Media"
                      ? "VM"
                      : department.name.slice(0, 2).toUpperCase()}
                  </span>
                  <ArrowRight size={17} />
                </div>
                <h2>{department.name}</h2>
                <div className="overview-metrics">
                  <span>
                    <strong>{active}</strong> active
                  </span>
                  <span>
                    <strong>{complete}</strong> completed
                  </span>
                </div>
              </a>
            );
          })}
        </div>
      )}
      <section
        className="task-board"
        aria-label={selected ? "Team tasks" : "Task overview"}
      >
        <DataTable.Root columns={taskColumns} data={tableRows} getRowId={getTaskRowId}>
          <DataTable.Toolbar>
            <DataTable.Title>{selected ? "Team tasks" : "Task overview"}</DataTable.Title>
            <DataTable.Actions>
              <label className="table-search !w-[320px] !max-w-full !flex-none">
                <Search size={16} />
                <input
                  className="!min-w-0 !w-full"
                  aria-label="Search tasks"
                  placeholder="Search by title or ministry"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <FilterDrawer activeCount={filter === "all" ? 0 : 1} onReset={() => setFilter("all")}>
                <Field label="Status">
                  <select aria-label="Filter tasks by status" value={filter} onChange={(event) => setFilter(event.target.value)}>
                    <option value="all">All statuses</option>
                    <option value="pending">Pending</option>
                    <option value="in-progress">In progress</option>
                    <option value="completed">Completed</option>
                  </select>
                </Field>
              </FilterDrawer>
            </DataTable.Actions>
          </DataTable.Toolbar>
          <DataTable.Table className="task-table min-w-[1080px] text-left">
            <DataTable.Caption>Task overview</DataTable.Caption>
            <DataTable.Header />
            <DataTable.Body
              emptyMessage={
                <div className="task-empty">
                  <div className="empty-icon">
                    <Filter size={21} />
                  </div>
                  <h3>
                    {query || filter !== "all"
                      ? "No tasks match these filters"
                      : "No tasks here yet"}
                  </h3>
                  <p>
                    {query || filter !== "all"
                      ? "Try another search or status filter."
                      : "Tasks routed to this team will appear here."}
                  </p>
                  {(query || filter !== "all") && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setQuery("");
                        setFilter("all");
                      }}
                    >
                      Clear filters
                    </Button>
                  )}
                </div>
              }
            />
          </DataTable.Table>
        </DataTable.Root>
      </section>
      <DetailsDrawer
        open={Boolean(selectedTask)}
        onClose={() => setSelectedTaskId(null)}
        title="Task details"
      >
        {selectedTask && <TaskDetails task={selectedTask} />}
      </DetailsDrawer>
      {selected && (
        <Link className="back-link" to="/departments">
          ← Back to all departments
        </Link>
      )}
    </div>
  );
}
