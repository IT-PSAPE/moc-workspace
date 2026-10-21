import { useState, type ReactNode } from "react";
import { CalendarDays, MessageSquare } from "lucide-react";
import { Badge } from "@moc/ui";
import type { Task } from "@moc/shared";
import { useWorkspace } from "@moc/client";
import TeamComments from "./TeamComments";
import "./task-details.css";

export default function TaskDetails({
  task,
  children,
}: {
  task: Task;
  children?: ReactNode;
}) {
  const { state, user } = useWorkspace();
  const [tab, setTab] = useState("overview");
  const canComment =
    user?.approved &&
    (user.department === "cell-0" || user.department === task.department);
  const reference = state?.requests.find(
    (request) => request.id === task.requestId,
  )?.reference;
  const department = state?.catalog?.departments.find(
    (item) => item.id === task.department,
  );
  const service = state?.catalog?.services.find(
    (item) => item.id === task.service,
  );
  return (
    <div className="task-details">
      <header className="task-details-title">
        <span>
          {reference ?? (task.requestId ? "Ministry request" : "Internal task")}
        </span>
        <h2>{task.title}</h2>
        <div>
          <Badge
            tone={
              task.status === "completed"
                ? "green"
                : task.status === "in-progress"
                  ? "gold"
                  : "neutral"
            }
          >
            {task.status.replace("-", " ")}
          </Badge>
        </div>
      </header>
      <nav className="task-detail-tabs" aria-label="Task detail sections">
        <button
          aria-pressed={tab === "overview"}
          onClick={() => setTab("overview")}
        >
          Overview
        </button>
        {canComment && (
          <button
            aria-pressed={tab === "comments"}
            onClick={() => setTab("comments")}
          >
            <MessageSquare size={14} />
            Comments <span>{task.privateNotes.length}</span>
          </button>
        )}
      </nav>
      {tab === "overview" && (
        <>
          <section className="task-details-section">
            <h3>Schedule & assignment</h3>
            <dl className="task-metadata">
              <div className="task-metadata-deadline">
                <dt>
                  <CalendarDays size={14} />
                  Deadline
                </dt>
                <dd>
                  <time dateTime={task.dueAt}>
                    {new Intl.DateTimeFormat("en-ZA", {
                      dateStyle: "long",
                      timeStyle: "short",
                    }).format(new Date(task.dueAt))}
                  </time>
                </dd>
              </div>
              <div>
                <dt>Department</dt>
                <dd>{department?.name ?? "Department unavailable"}</dd>
              </div>
              <div>
                <dt>Team</dt>
                <dd>{task.subTeam}</dd>
              </div>
              <div>
                <dt>Ministry</dt>
                <dd>{task.ministry || "Cell 0"}</dd>
              </div>
              <div>
                <dt>Service</dt>
                <dd>{service?.name ?? "Service unavailable"}</dd>
              </div>
            </dl>
          </section>
          <section className="task-details-section">
            <h3>Request brief</h3>
            <div className="task-brief">
              <h4>Instructions</h4>
              <p>{task.instructions || "No instructions provided."}</p>
              {task.notes && (
                <>
                  <h4>Additional notes</h4>
                  <p>{task.notes}</p>
                </>
              )}
            </div>
          </section>
          <section className="task-details-section">
            {children || (
              <>
                <div className="task-details-section-heading">
                  <h3>Progress</h3>
                  <strong>{task.progress}%</strong>
                </div>
                <div
                  className="progress-track"
                  role="progressbar"
                  aria-label="Task progress"
                  aria-valuenow={task.progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <span style={{ width: `${task.progress}%` }} />
                </div>
              </>
            )}
          </section>
        </>
      )}
      {canComment && (
        <TeamComments
          notes={task.privateNotes}
          target={{ kind: "task", id: task.id }}
          audience="Private to Cell 0 and this department’s leaders."
          hidden={tab !== "comments"}
        />
      )}
    </div>
  );
}
