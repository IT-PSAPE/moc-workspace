import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  FileText,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { Badge, Button, Field, Modal } from "@moc/ui";
import {
  DEPARTMENTS,
  SERVICES,
  type MinistryRequest,
  type Priority,
} from "@moc/shared";
import { useWorkspace } from "@moc/client";
import "./workflows.css";

const statuses = ["pending", "approved", "rejected"] as const;
const priorityTone: Record<Priority, "neutral" | "gold" | "red" | "green"> = {
  low: "neutral",
  medium: "green",
  high: "gold",
  urgent: "red",
};
const fmtDate = (value: string) =>
  new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));

export default function RequestsPage() {
  const { state, user, loading, error, act, refresh } = useWorkspace();
  const isCell0 = user?.approved && user.department === "cell-0";
  const [filter, setFilter] = useState("pending");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const requests = useMemo(
    () =>
      (state?.requests ?? []).filter(
        (request) =>
          request.status === filter &&
          (request.reference + " " + request.ministry + " " + request.title)
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    [state, filter, search],
  );
  const selected = useMemo(
    () =>
      (state?.requests ?? []).find((request) => request.id === selectedId) ??
      null,
    [state, selectedId],
  );
  const count = (status: string) =>
    (state?.requests ?? []).filter((request) => request.status === status)
      .length;
  const selectedService = selected
    ? SERVICES.find((service) => service.id === selected.service)
    : undefined;
  const shortNotice = (request: MinistryRequest) => {
    const hours = (new Date(request.dueAt).getTime() - Date.now()) / 3600000;
    return hours >= 0 && hours < 24;
  };
  const saveAction = async (
    action: Parameters<typeof act>[0],
    close = true,
  ) => {
    setBusy(true);
    setFeedback("");
    try {
      await act(action);
      if (close) setSelectedId(null);
      setRejectOpen(false);
      setReason("");
    } catch (cause) {
      setFeedback(
        cause instanceof Error
          ? cause.message
          : "The request could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  };
  const approve = () =>
    selected &&
    void saveAction({ type: "approve", requestId: selected.id, priority });
  const reject = (event: React.FormEvent) => {
    event.preventDefault();
    if (selected)
      void saveAction({ type: "reject", requestId: selected.id, reason });
  };
  const showRequest = (request: MinistryRequest) => {
    setSelectedId(request.id);
    setFeedback("");
    setPriority("medium");
    void refresh();
  };

  if (loading)
    return (
      <div className="workspace-page">
        <div className="workflow-skeleton" />
      </div>
    );
  if (!isCell0)
    return (
      <div className="workspace-page">
        <section className="workflow-empty">
          <FileText />
          <h2>Requests are managed by Cell 0</h2>
          <p>Ministry requests are reviewed and routed by the Cell 0 team.</p>
        </section>
      </div>
    );

  return (
    <div className="workspace-page workflow-page">
      <div className="page-header workflow-header">
        <div className="page-heading">
          <h1>Requests</h1>
        </div>
      </div>
      <div className="request-tabs" role="tablist" aria-label="Filter requests">
        {statuses.map((status) => (
          <button
            role="tab"
            aria-selected={filter === status}
            className={filter === status ? "request-tab active" : "request-tab"}
            key={status}
            onClick={() => setFilter(status)}
          >
            {status[0].toUpperCase() + status.slice(1)}
            <span>{count(status)}</span>
          </button>
        ))}
      </div>
      <div className="workflow-toolbar requests-toolbar">
        <div className="workflow-search">
          <Search size={17} />
          <input
            aria-label="Search requests"
            placeholder="Search reference, ministry or title…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <span className="request-result-count">
          {requests.length} {requests.length === 1 ? "request" : "requests"}
        </span>
        <Button size="sm" onClick={() => void refresh()}>
          <RefreshCw size={14} /> Refresh
        </Button>
      </div>
      {(error || feedback) && (
        <div className="workflow-alert" role="alert">
          <span>{feedback || error}</span>
          <button aria-label="Dismiss" onClick={() => setFeedback("")}>
            <X size={15} />
          </button>
        </div>
      )}
      <section className="request-list" aria-label={filter + " requests"}>
        {requests.map((request) => {
          const service = SERVICES.find((item) => item.id === request.service);
          const department = DEPARTMENTS.find(
            (item) => item.id === service?.department,
          );
          return (
            <button
              className="request-row"
              key={request.id}
              onClick={() => showRequest(request)}
            >
              <div className="request-row-main">
                <div className="request-icon">
                  <FileText size={18} />
                </div>
                <div className="request-title-block">
                  <div className="request-row-label">
                    <span>{request.reference}</span>
                    {shortNotice(request) && (
                      <span className="short-notice-label">
                        <AlertTriangle size={13} /> Short notice
                      </span>
                    )}
                  </div>
                  <h2>{request.title}</h2>
                  <p>
                    {request.ministry} <span>·</span>{" "}
                    {service?.name ?? request.service}
                  </p>
                </div>
              </div>
              <div className="request-row-side">
                <div>
                  <span>Due</span>
                  <strong>{fmtDate(request.dueAt)}</strong>
                </div>
                {department && (
                  <Badge tone="neutral">
                    {department.name} / {service?.subTeam}
                  </Badge>
                )}
                <ArrowUpRight size={17} />
              </div>
            </button>
          );
        })}
        {requests.length === 0 && (
          <div className="workflow-empty list-empty">
            <FileText />
            <h2>{search ? "No matching requests" : "All caught up"}</h2>
            <p>
              {search
                ? "Try a different search term."
                : "There are no " +
                  filter +
                  " requests in the inbox right now."}
            </p>
          </div>
        )}
      </section>

      <Modal
        open={Boolean(selectedId) && !rejectOpen}
        onClose={() => setSelectedId(null)}
        title="Request details"
      >
        {selected && (
          <div className="workflow-detail">
            <div className="detail-title-row">
              <div>
                <div className="eyebrow">
                  {selected.reference} · submitted {fmtDate(selected.createdAt)}
                </div>
                <h2>{selected.title}</h2>
              </div>
              <Badge
                tone={
                  selected.status === "pending"
                    ? "gold"
                    : selected.status === "approved"
                      ? "green"
                      : "red"
                }
              >
                {selected.status}
              </Badge>
            </div>
            {shortNotice(selected) && (
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
            <div className="detail-grid">
              <div>
                <span>Ministry</span>
                <strong>{selected.ministry}</strong>
              </div>
              <div>
                <span>Service</span>
                <strong>{selectedService?.name ?? selected.service}</strong>
              </div>
              <div>
                <span>Routing</span>
                <strong>
                  {
                    DEPARTMENTS.find(
                      (item) => item.id === selectedService?.department,
                    )?.name
                  }{" "}
                  · {selectedService?.subTeam}
                </strong>
              </div>
              <div>
                <span>Requested delivery</span>
                <strong>{fmtDate(selected.dueAt)}</strong>
              </div>
            </div>
            <div className="detail-copy">
              <span>Instructions</span>
              <p>{selected.instructions}</p>
            </div>
            <div className="detail-copy">
              <span>Additional notes</span>
              <p>{selected.notes}</p>
            </div>
            {selected.airedDates?.length ? (
              <div className="detail-copy">
                <span>Original aired dates</span>
                <div className="aired-date-list">
                  {selected.airedDates.map((date) => (
                    <Badge key={date}>
                      {new Intl.DateTimeFormat("en-ZA", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                        timeZone: "UTC",
                      }).format(new Date(date + "T00:00:00Z"))}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
            {selected.rejectionReason && (
              <div className="rejection-reason">
                <span>Reason returned to ministry</span>
                <p>{selected.rejectionReason}</p>
              </div>
            )}
            {selected.status === "pending" && (
              <div className="request-review-actions">
                <Field label="Set task priority">
                  <select
                    value={priority}
                    onChange={(event) =>
                      setPriority(event.target.value as Priority)
                    }
                  >
                    {(["low", "medium", "high", "urgent"] as Priority[]).map(
                      (item) => (
                        <option value={item} key={item}>
                          {item[0].toUpperCase() + item.slice(1)}
                        </option>
                      ),
                    )}
                  </select>
                </Field>
                <div className="detail-actions">
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => {
                      setFeedback("");
                      setRejectOpen(true);
                    }}
                  >
                    Reject request
                  </Button>
                  <Button variant="primary" disabled={busy} onClick={approve}>
                    <Check size={15} />{" "}
                    {busy ? "Routing…" : "Approve and route"}
                  </Button>
                </div>
              </div>
            )}
            {feedback && (
              <div className="workflow-alert" role="alert">
                {feedback}
              </div>
            )}
          </div>
        )}
      </Modal>
      <Modal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title="Return request"
      >
        <form className="workflow-form" onSubmit={reject}>
          <p className="form-intro">
            Share a clear reason so the ministry knows what to change before
            resubmitting.
          </p>
          <Field label="Reason for rejection">
            <textarea
              required
              minLength={3}
              maxLength={1000}
              rows={4}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Explain why this request can’t be accepted as submitted."
            />
          </Field>
          {feedback && (
            <div className="workflow-alert" role="alert">
              {feedback}
            </div>
          )}
          <div className="form-actions">
            <Button type="button" onClick={() => setRejectOpen(false)}>
              Go back
            </Button>
            <Button
              type="submit"
              variant="danger"
              disabled={busy || !reason.trim()}
            >
              {busy ? "Returning…" : "Return request"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
