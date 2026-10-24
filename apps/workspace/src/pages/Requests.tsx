import { useCallback, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, FileText, Search, X } from "lucide-react";
import {
  Button,
  DataTable,
  Field,
  Modal,
  SegmentedControl,
} from "@moc/ui";
import type { MinistryRequest } from "@moc/shared";
import { useWorkspace } from "@moc/client";
import RequestDetails from "../RequestDetails";
import DetailsDrawer from "../components/DetailsDrawer";
import {
  createWorkColumns,
  WORK_TABLE_MIN_WIDTH,
  type WorkTableRow,
} from "../components/WorkTable";
import "./workflows.css";

const statuses = ["all", "backlog", "approved", "rejected"] as const;
const requestColumns = createWorkColumns<WorkTableRow>();

const requestStatusTone = (status: MinistryRequest["status"]) =>
  status === "approved" ? "green" : status === "rejected" ? "red" : "neutral";

const isShortNotice = (request: MinistryRequest) => {
  const hours = (new Date(request.dueAt).getTime() - Date.now()) / 3600000;
  return hours >= 0 && hours < 24;
};

export default function RequestsPage() {
  const { state, user, loading, act, refresh } = useWorkspace();
  const isCell0 = Boolean(user?.approved && user.department === "cell-0");
  const canReview = isCell0 && Boolean(user?.isLeader);
  const [filter, setFilter] = useState("backlog");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const showRequest = useCallback(
    (request: MinistryRequest) => {
      setSelectedId(request.id);
      setFeedback("");
      void refresh();
    },
    [refresh],
  );
  const requests = useMemo(
    () => {
      const query = search.trim().toLocaleLowerCase();
      return (state?.requests ?? [])
        .map((request) => {
          const service = state.catalog.services.find(
            (item) => item.id === request.service,
          );
          const assignedTask = state.tasks.find(
            (item) => request.taskId
              ? item.id === request.taskId
              : item.requestId === request.id,
          );
          const department = state.catalog.departments.find(
            (item) =>
              item.id === (assignedTask?.department ?? service?.department),
          );
          return {
            id: request.id,
            title: request.title,
            ministry: request.ministry,
            serviceName: service?.name ?? request.service,
            dueAt: request.dueAt,
            departmentName: department?.name ?? "Unassigned",
            departmentColor: department?.color,
            groupName: assignedTask?.subTeam ?? service?.subTeam ?? "Unassigned",
            statusLabel: request.status[0].toUpperCase() + request.status.slice(1),
            statusTone: requestStatusTone(request.status),
            isShortNotice: isShortNotice(request),
            onOpen: () => showRequest(request),
            request,
          } satisfies WorkTableRow & { request: MinistryRequest };
        })
        .filter(({ request, serviceName, departmentName, groupName }) => {
          const matchesStatus = filter === "all" || request.status === filter;
          const searchable =
            `${request.reference} ${request.title} ${request.ministry} ${serviceName} ${departmentName} ${groupName}`.toLocaleLowerCase();
          return matchesStatus && (!query || searchable.includes(query));
        });
    },
    [state, filter, search, showRequest],
  );
  const selected = useMemo(
    () =>
      (state?.requests ?? []).find((request) => request.id === selectedId) ??
      null,
    [state, selectedId],
  );
  const count = (status: (typeof statuses)[number]) =>
    status === "all"
      ? (state?.requests ?? []).length
      : (state?.requests ?? []).filter((request) => request.status === status)
          .length;
  const statusOptions = statuses.map((status) => ({
    value: status,
    label: `${status === "all" ? "All requests" : status[0].toUpperCase() + status.slice(1)} · ${count(status)}`,
  }));
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
        {canReview && <Link to="/settings" hash="public-request" className="button button-secondary button-md">Public request settings</Link>}
      </div>
      <div className="workflow-toolbar requests-toolbar !flex-row !flex-wrap">
        <div className="max-w-full overflow-x-auto [&_button]:whitespace-nowrap max-[400px]:[&_button]:px-1.5 max-[400px]:[&_button]:text-xs">
          <SegmentedControl
            label="Filter requests by status"
            value={filter}
            onValueChange={setFilter}
            options={statusOptions}
          />
        </div>
        <div className="workflow-search !ml-auto !w-full !min-w-0 !max-w-[320px] !flex-none">
          <Search size={17} />
          <input
            aria-label="Search requests"
            placeholder="Search reference, title, ministry, service or routing…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>
      {feedback && (
        <div className="workflow-alert" role="alert">
          <span>{feedback}</span>
          <button aria-label="Dismiss" onClick={() => setFeedback("")}>
            <X size={15} />
          </button>
        </div>
      )}
      <DataTable.Root
        className="request-list"
        role="region"
        aria-label={filter + " requests"}
        columns={requestColumns}
        data={requests}
        getRowId={(row: WorkTableRow) => row.id}
      >
        <DataTable.Table
          className="requests-data-table text-left"
          style={{ minWidth: WORK_TABLE_MIN_WIDTH }}
          containerClassName="requests-data-table-container"
        >
          <DataTable.Caption>
            {filter === "all" ? "All" : filter} ministry requests
          </DataTable.Caption>
          <DataTable.Header />
          <DataTable.Body
            emptyMessage={
              search
                ? "No matching requests. Try a different search term."
                : `There are no ${filter === "all" ? "" : `${filter} `}requests in the inbox right now.`
            }
            rowClassName="request-row"
          />
        </DataTable.Table>
      </DataTable.Root>

      <DetailsDrawer
        open={Boolean(selectedId) && !rejectOpen}
        onClose={() => setSelectedId(null)}
        title="Request details"
      >
        {selected && (
          <RequestDetails key={selected.id} request={selected}>
            {canReview && selected.status !== "approved" && (
              <div className="request-review-actions">
                <div className="detail-actions">
                  {selected.status === "backlog" && (
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
                  )}
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
      </DetailsDrawer>
      <Modal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title="Reject request"
      >
        <form className="workflow-form" onSubmit={reject}>
          <p className="form-intro">
            Share a clear reason for the ministry. Rejected requests stay private
            to Cell 0 and can be approved later.
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
              {busy ? "Rejecting…" : "Reject request"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
