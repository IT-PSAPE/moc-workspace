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
import { type MinistryRequest } from "@moc/shared";
import { useWorkspace } from "@moc/client";
import RequestDetails from "../RequestDetails";
import RequestCatalog from "../RequestCatalog";
import { FilterDrawer } from "../components/UiDialogs";
import "./workflows.css";

const statuses = ["pending", "approved", "rejected"] as const;
const fmtDate = (value: string) =>
  new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));

export default function RequestsPage() {
  const { state, user, loading, act, refresh } = useWorkspace();
  const isCell0 =
    user?.approved && user.isLeader && user.department === "cell-0";
  const [filter, setFilter] = useState("pending");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const requests = useMemo(
    () =>
      (state?.requests ?? []).filter(
        (request) =>
          (filter === "all" || request.status === filter) &&
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
    selected && void saveAction({ type: "approve", requestId: selected.id });
  const reject = (event: React.FormEvent) => {
    event.preventDefault();
    if (selected)
      void saveAction({ type: "reject", requestId: selected.id, reason });
  };
  const showRequest = (request: MinistryRequest) => {
    setSelectedId(request.id);
    setFeedback("");
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
        <div className="page-heading">
          <h1>Requests</h1>
          <RequestCatalog />
        </div>
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
        <RequestCatalog />
      </div>
      <div className="workflow-toolbar requests-toolbar">
        <div className="workflow-search !w-full !max-w-[320px] !flex-none">
          <Search size={17} />
          <input
            aria-label="Search requests"
            placeholder="Search reference, ministry or title…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <FilterDrawer activeCount={filter === "all" ? 0 : 1} onReset={() => setFilter("all")}>
          <Field label="Status">
            <select aria-label="Filter requests by status" value={filter} onChange={(event) => setFilter(event.target.value)}>
              <option value="all">All statuses ({state.requests.length})</option>
              {statuses.map((status) => <option key={status} value={status}>{status[0].toUpperCase() + status.slice(1)} ({count(status)})</option>)}
            </select>
          </Field>
        </FilterDrawer>
        <span className="request-result-count">
          {requests.length} {requests.length === 1 ? "request" : "requests"}
        </span>
        <Button size="sm" onClick={() => void refresh()}>
          <RefreshCw size={14} /> Refresh
        </Button>
      </div>
      {feedback && (
        <div className="workflow-alert" role="alert">
          <span>{feedback}</span>
          <button aria-label="Dismiss" onClick={() => setFeedback("")}>
            <X size={15} />
          </button>
        </div>
      )}
      <section className="request-list" aria-label={filter + " requests"}>
        {requests.map((request) => {
          const service = state.catalog.services.find(
            (item) => item.id === request.service,
          );
          const assignedTask = state.tasks.find(
            (item) => item.id === request.taskId,
          );
          const department = state.catalog.departments.find(
            (item) =>
              item.id === (assignedTask?.department ?? service?.department),
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
                    {department.name} /{" "}
                    {assignedTask?.subTeam ?? service?.subTeam}
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
                  (filter === "all" ? "" : filter + " ") +
                  "requests in the inbox right now."}
            </p>
          </div>
        )}
      </section>

      <Modal
        open={Boolean(selectedId) && !rejectOpen}
        onClose={() => setSelectedId(null)}
        title="Request details"
        className="task-detail-modal"
      >
        {selected && (
          <RequestDetails key={selected.id} request={selected}>
            {selected.status === "pending" && (
              <div className="request-review-actions">
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
          </RequestDetails>
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
