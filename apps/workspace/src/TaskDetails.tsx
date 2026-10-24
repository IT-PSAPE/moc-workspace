import type { ReactNode } from "react";
import { Badge } from "@moc/ui";
import type { LifecycleTimestamps, Task } from "@moc/shared";
import { useWorkspace } from "@moc/client";
import TeamComments from "./TeamComments";
import "./task-details.css";

const dateTime = new Intl.DateTimeFormat("en-ZA", {
  dateStyle: "long",
  timeZone: "Africa/Johannesburg",
  timeStyle: "short",
});
const lifecycleStages: [keyof LifecycleTimestamps, string][] = [
  ["receivedAt", "Received"],
  ["approvedAt", "Approved"],
  ["rejectedAt", "Rejected"],
  ["inProgressAt", "In progress"],
  ["completedAt", "Completed"],
];

export default function TaskDetails({
  task,
  children,
}: {
  task: Task;
  children?: ReactNode;
}) {
  const { state, user } = useWorkspace();
  const canComment =
    user?.approved &&
    ((user.department === "cell-0" && user.isLeader) ||
      user.department === task.department);
  const request = state?.requests.find((item) => item.id === task.requestId);
  const department = state?.catalog?.departments.find(
    (item) => item.id === task.department,
  );
  const service = state?.catalog?.services.find(
    (item) => item.id === task.service,
  );
  const lifecycle = { ...request?.lifecycle, ...task.lifecycle };
  const recordedStages = lifecycleStages.filter(([key]) => lifecycle[key]);
  const airedDates = task.airedDates ?? request?.airedDates;

  return (
    <div className="task-details">
      <header className="task-details-title">
        <span>
          {request?.reference ??
            (task.requestId ? "Ministry request" : "Internal task")}
        </span>
        <h2>{task.title}</h2>
        <Badge
          tone={
            task.status === "completed"
              ? "green"
              : task.status === "in-progress"
                ? "gold"
                : "neutral"
          }
        >
          {task.status === "pending"
            ? "Pending"
            : task.status === "in-progress"
              ? "In progress"
              : "Completed"}
        </Badge>
      </header>
      <section className="task-details-section">
        <h3>Delivery & routing</h3>
        <dl className="request-property-list">
          <div>
            <dt>Ministry</dt>
            <dd>{task.ministry || "Cell 0"}</dd>
          </div>
          <div>
            <dt>Service</dt>
            <dd>
              {service?.name ??
                (task.service ? "Service unavailable" : "Not assigned")}
            </dd>
          </div>
          <div>
            <dt>Due date</dt>
            <dd>
              <time dateTime={task.dueAt}>
                {dateTime.format(new Date(task.dueAt))}
              </time>
            </dd>
          </div>
          <div>
            <dt>Group</dt>
            <dd>{task.subTeam || "Not assigned"}</dd>
          </div>
          <div>
            <dt>Department</dt>
            <dd>{department?.name ?? "Department unavailable"}</dd>
          </div>
        </dl>
      </section>
      <section className="task-details-section">
        <h3>Request brief</h3>
        <dl className="request-property-list">
          <div>
            <dt>Instructions</dt>
            <dd className="task-brief-value">
              {task.instructions.trim() || "No instructions provided."}
            </dd>
          </div>
          {task.notes.trim() && (
            <div>
              <dt>Additional notes</dt>
              <dd className="task-brief-value">{task.notes}</dd>
            </div>
          )}
          {Boolean(airedDates?.length) && (
            <div>
              <dt>Original aired dates</dt>
              <dd className="task-brief-value">
                {airedDates
                  ?.map((date) =>
                    new Intl.DateTimeFormat("en-ZA", {
                      dateStyle: "long",
                      timeZone: "UTC",
                    }).format(new Date(`${date}T00:00:00Z`)),
                  )
                  .join(" · ")}
              </dd>
            </div>
          )}
        </dl>
      </section>
      {recordedStages.length > 0 && (
        <section className="task-details-section">
          <h3>Lifecycle</h3>
          <dl className="request-property-list">
            {recordedStages.map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>
                  <time dateTime={lifecycle[key]}>
                    {dateTime.format(new Date(lifecycle[key]!))}
                  </time>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {children && (
        <section className="task-details-section">{children}</section>
      )}
      {canComment && (
        <TeamComments
          notes={task.privateNotes}
          target={{ kind: "task", id: task.id }}
          audience="Private to Cell 0 and this department."
        />
      )}
    </div>
  );
}
