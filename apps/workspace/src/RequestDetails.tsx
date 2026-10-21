import { useState, type ReactNode } from "react";
import { AlertTriangle, MessageSquare } from "lucide-react";
import { Badge } from "@moc/ui";
import type { MinistryRequest } from "@moc/shared";
import { useWorkspace } from "@moc/client";
import TeamComments from "./TeamComments";
import "./task-details.css";

export default function RequestDetails({
  request,
  children,
}: {
  request: MinistryRequest;
  children?: ReactNode;
}) {
  const { state } = useWorkspace();
  const [tab, setTab] = useState("overview");
  const service = state?.catalog?.services.find(
    (item) => item.id === request.service,
  );
  const task = state?.tasks.find((item) => item.id === request.taskId);
  const routeDepartmentId =
    request.status === "approved" ? task?.department : service?.department;
  const routeGroup =
    request.status === "approved" ? task?.subTeam : service?.subTeam;
  const routeDepartment = state?.catalog?.departments.find(
    (item) => item.id === routeDepartmentId,
  );
  const notes = task?.privateNotes ?? request.privateNotes ?? [];
  return (
    <div className="task-details request-details">
      <header className="task-details-title">
        <span>
          {request.reference} · Submitted{" "}
          {new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium" }).format(
            new Date(request.createdAt),
          )}
        </span>
        <h2>{request.title}</h2>
        <Badge
          tone={
            request.status === "approved"
              ? "green"
              : request.status === "rejected"
                ? "red"
                : "gold"
          }
        >
          {request.status}
        </Badge>
      </header>
      <nav className="task-detail-tabs" aria-label="Request detail sections">
        <button
          aria-pressed={tab === "overview"}
          onClick={() => setTab("overview")}
        >
          Overview
        </button>
        <button
          aria-pressed={tab === "comments"}
          onClick={() => setTab("comments")}
        >
          <MessageSquare size={14} />
          Comments <span>{notes.length}</span>
        </button>
      </nav>
      {tab === "overview" && (
        <>
          {request.status === "pending" &&
            Date.parse(request.dueAt) >= Date.now() &&
            Date.parse(request.dueAt) - Date.now() < 86400000 && (
              <div className="short-notice-banner">
                <AlertTriangle size={17} />
                <div>
                  <strong>Short notice request</strong>
                  <p>
                    This deadline is less than 24 hours away. You can still
                    approve and route it.
                  </p>
                </div>
              </div>
            )}
          <section className="task-details-section">
            <h3>Delivery & routing</h3>
            <dl className="request-property-list">
              <div>
                <dt>Requested delivery</dt>
                <dd>
                  <time dateTime={request.dueAt}>
                    {new Intl.DateTimeFormat("en-ZA", {
                      dateStyle: "long",
                      timeStyle: "short",
                    }).format(new Date(request.dueAt))}
                  </time>
                </dd>
              </div>
              <div>
                <dt>Ministry</dt>
                <dd>{request.ministry}</dd>
              </div>
              <div>
                <dt>Service</dt>
                <dd>{service?.name ?? "Service unavailable"}</dd>
              </div>
              <div>
                <dt>Department</dt>
                <dd>
                  {routeDepartment?.name ??
                    (request.status === "approved" && !task
                      ? "Not assigned"
                      : routeDepartmentId
                        ? "Department unavailable"
                        : "Not assigned")}
                </dd>
              </div>
              <div>
                <dt>Group</dt>
                <dd>{routeGroup?.trim() || "Not assigned"}</dd>
              </div>
            </dl>
          </section>
          <section className="task-details-section">
            <h3>Request brief</h3>
            <dl className="request-property-list">
              <div>
                <dt>Instructions</dt>
                <dd className="task-brief-value">
                  {request.instructions.trim() || "No instructions provided."}
                </dd>
              </div>
              {request.notes.trim() && (
                <div>
                  <dt>Additional notes</dt>
                  <dd className="task-brief-value">{request.notes}</dd>
                </div>
              )}
              {Boolean(request.airedDates?.length) && (
                <div>
                  <dt>Original aired dates</dt>
                  <dd className="task-brief-value">
                    {request.airedDates
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
              {request.rejectionReason && (
                <div>
                  <dt>Reason returned to ministry</dt>
                  <dd className="task-brief-value">{request.rejectionReason}</dd>
                </div>
              )}
            </dl>
          </section>
          {children && (
            <section className="task-details-section">{children}</section>
          )}
        </>
      )}
      <TeamComments
        notes={notes}
        target={{
          kind: task ? "task" : "request",
          id: task?.id ?? request.id,
        }}
        audience={
          task
            ? "Private to Cell 0 and the assigned department’s leaders."
            : "Private to Cell 0. Shared with the assigned department when this request is approved."
        }
        hidden={tab !== "comments"}
      />
    </div>
  );
}
