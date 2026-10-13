import {
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Tabs } from "@base-ui/react/tabs";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  LockKeyhole,
  Plus,
  X,
} from "lucide-react";
import {
  DEPARTMENTS,
  MINISTRIES,
  SERVICES,
  type PublicRequest,
  type PublicTracking,
  type RequestInput,
  type Service,
  type SubmissionReceipt,
} from "@moc/shared";
import { api, ApiError } from "@moc/client";
import "./styles.css";

type Tab = "request" | "track";
type Catalog = { services: Service[]; ministries: string[] };

const todayIsoDate = () => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
};

function initialDueAt() {
  const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const blankRequest = (): RequestInput => ({
  ministry: "",
  service: "",
  title: "",
  instructions: "",
  notes: "",
  dueAt: initialDueAt(),
  airedDates: [],
});

const localDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const prettyDate = (value: string) =>
  new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

function Field({
  label,
  children,
  required = false,
  hint,
}: {
  label: string;
  children: ReactNode;
  required?: boolean;
  hint?: string;
}) {
  return (
    <label className="portal-field">
      <span className="portal-field-label">
        {label}
        {required && (
          <span className="required-mark" aria-hidden="true">
            *
          </span>
        )}
      </span>
      {children}
      {hint && <span className="portal-field-hint">{hint}</span>}
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  placeholder,
  disabled = false,
  required = true,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  placeholder: string;
  disabled?: boolean;
  required?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label} required={required}>
      <span className={`select-wrap${disabled ? " is-disabled" : ""}`}>
        <select
          required={required}
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">{placeholder}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown size={17} aria-hidden="true" />
      </span>
    </Field>
  );
}

function safeApiError(error: unknown, action: "track" | "save" | "send") {
  if (error instanceof ApiError) {
    if (error.status === 404)
      return "We couldn’t find a request with that code. Check it and try again.";
    if (error.status === 429)
      return "There have been too many attempts. Wait a moment, then try again.";
    if (error.status >= 500)
      return "The service is temporarily unavailable. Please try again shortly.";
    if (error.status === 400 && action !== "track") return error.message;
  }
  if (error instanceof TypeError)
    return "We couldn’t connect. Check your connection and try again.";
  if (action === "track")
    return "We couldn’t check this code. Please try again.";
  if (action === "save")
    return "We couldn’t save those changes. Please try again.";
  return "We couldn’t send your request. Please try again.";
}

function requestInputForApi(
  draft: RequestInput,
  service?: Service,
): { input?: RequestInput; error?: string } {
  const dueDate = new Date(draft.dueAt);
  if (!Number.isFinite(dueDate.valueOf()))
    return { error: "Choose a valid completion date and time." };
  if (dueDate.getTime() <= Date.now())
    return { error: "Choose a future date and time for completion." };
  if (service?.requiresAiredDates && !(draft.airedDates ?? []).some(Boolean)) {
    return {
      error:
        "Add at least one exact aired date to retrieve a previously aired video.",
    };
  }
  return {
    input: {
      ...draft,
      dueAt: dueDate.toISOString(),
      airedDates: service?.requiresAiredDates
        ? (draft.airedDates ?? [])
        : undefined,
    },
  };
}

export default function Portal() {
  const [tab, setTab] = useState<Tab>("request");
  const [createForm, setCreateForm] = useState<RequestInput>(blankRequest);
  const [editForm, setEditForm] = useState<RequestInput>(blankRequest);
  const [trackingCodeInput, setTrackingCodeInput] = useState("");
  const [tracking, setTracking] = useState<PublicTracking | null>(null);
  const [receipt, setReceipt] = useState<SubmissionReceipt | null>(null);
  const [activeTrackingCode, setActiveTrackingCode] = useState<string | null>(
    null,
  );
  const [editSaved, setEditSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [formError, setFormError] = useState("");
  const [trackError, setTrackError] = useState("");
  const lookupSequence = useRef(0);
  const activeTrackingCodeRef = useRef<string | null>(null);

  const catalogQuery = useQuery({
    queryKey: ["public-catalog"],
    queryFn: () => api<Catalog>("/api/catalog"),
    staleTime: 5 * 60 * 1000,
  });

  const services = catalogQuery.data?.services ?? SERVICES;
  const ministries = useMemo(
    () =>
      (catalogQuery.data?.ministries ?? MINISTRIES)
        .slice()
        .sort((a, b) => a.localeCompare(b)),
    [catalogQuery.data?.ministries],
  );
  const orderedServices = useMemo(
    () => services.slice().sort((a, b) => a.name.localeCompare(b.name)),
    [services],
  );
  const selectedCreateService = services.find(
    (service) => service.id === createForm.service,
  );
  const selectedEditService = services.find(
    (service) => service.id === editForm.service,
  );
  const createShortNotice =
    !!createForm.dueAt &&
    new Date(createForm.dueAt).getTime() > Date.now() &&
    new Date(createForm.dueAt).getTime() - Date.now() < 24 * 60 * 60 * 1000;
  const editShortNotice =
    !!editForm.dueAt &&
    new Date(editForm.dueAt).getTime() > Date.now() &&
    new Date(editForm.dueAt).getTime() - Date.now() < 24 * 60 * 60 * 1000;

  const submitMutation = useMutation({
    mutationFn: (input: RequestInput) =>
      api<SubmissionReceipt>("/api/requests", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (result) => {
      setReceipt(result);
      setFormError("");
      setCopied(false);
    },
    onError: (error) => setFormError(safeApiError(error, "send")),
  });

  const trackMutation = useMutation({
    mutationFn: ({ code }: { code: string; id: number }) =>
      api<PublicTracking>("/api/track", {
        method: "POST",
        body: JSON.stringify({ code }),
      }),
    onSuccess: (result, variables) => {
      if (variables.id !== lookupSequence.current) return;
      setTracking(result);
      setActiveTrackingCode(variables.code);
      activeTrackingCodeRef.current = variables.code;
      setEditSaved(false);
      setEditForm({
        ...result.request,
        dueAt: localDateTime(result.request.dueAt),
        airedDates: result.request.airedDates ?? [],
      });
      setFormError("");
      setTrackError("");
    },
    onError: (error, variables) => {
      if (variables.id !== lookupSequence.current) return;
      setTracking(null);
      setActiveTrackingCode(null);
      activeTrackingCodeRef.current = null;
      setEditSaved(false);
      setTrackError(safeApiError(error, "track"));
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ code, input }: { code: string; input: RequestInput }) =>
      api<PublicRequest>("/api/requests", {
        method: "PATCH",
        body: JSON.stringify({ code, input }),
      }),
    onSuccess: (request, variables) => {
      if (variables.code !== activeTrackingCodeRef.current) return;
      setTracking((previous) =>
        previous ? { ...previous, request } : previous,
      );
      setEditForm({
        ...request,
        dueAt: localDateTime(request.dueAt),
        airedDates: request.airedDates ?? [],
      });
      setEditSaved(true);
      setFormError("");
    },
    onError: (error, variables) => {
      if (variables.code !== activeTrackingCodeRef.current) return;
      if (error instanceof ApiError && error.status === 404) {
        setFormError(
          "This request may have been reviewed while you were editing. Checking its latest status…",
        );
        const id = ++lookupSequence.current;
        setTracking(null);
        setActiveTrackingCode(null);
        activeTrackingCodeRef.current = null;
        trackMutation.mutate({ code: variables.code, id });
        return;
      }
      setFormError(safeApiError(error, "save"));
    },
  });

  const updateDraft = (
    setter: typeof setCreateForm,
    key: keyof RequestInput,
    value: string | string[],
  ) => {
    setEditSaved(false);
    setFormError("");
    setter((previous) => {
      if (key === "service" && typeof value === "string") {
        const service = services.find((item) => item.id === value);
        return {
          ...previous,
          service: value,
          airedDates: service?.requiresAiredDates
            ? previous.airedDates?.length
              ? previous.airedDates
              : [""]
            : [],
        };
      }
      return { ...previous, [key]: value };
    });
  };

  const submitCreateRequest = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");
    const prepared = requestInputForApi(createForm, selectedCreateService);
    if (!prepared.input)
      return setFormError(
        prepared.error ?? "Check the request details and try again.",
      );
    submitMutation.mutate(prepared.input);
  };

  const submitEditRequest = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");
    if (
      !tracking ||
      tracking.request.status !== "pending" ||
      !activeTrackingCode
    ) {
      setFormError(
        "This request is no longer open for changes. Look it up again to refresh its status.",
      );
      return;
    }
    const prepared = requestInputForApi(editForm, selectedEditService);
    if (!prepared.input)
      return setFormError(
        prepared.error ?? "Check the request details and try again.",
      );
    editMutation.mutate({ code: activeTrackingCode, input: prepared.input });
  };

  const beginLookup = (code: string) => {
    const id = ++lookupSequence.current;
    setTracking(null);
    setEditForm(blankRequest());
    setActiveTrackingCode(null);
    activeTrackingCodeRef.current = null;
    setEditSaved(false);
    setFormError("");
    setTrackError("");
    trackMutation.mutate({ code, id });
  };

  const trackRequest = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = trackingCodeInput.trim();
    setTrackingCodeInput(code);
    beginLookup(code);
  };

  const copyCode = async () => {
    if (!receipt) return;
    try {
      await navigator.clipboard.writeText(receipt.trackingCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
      setFormError("Copy is unavailable here. Select the code to copy it.");
    }
  };

  const cancelEdit = () => {
    if (!tracking) return;
    setEditForm({
      ...tracking.request,
      dueAt: localDateTime(tracking.request.dueAt),
      airedDates: tracking.request.airedDates ?? [],
    });
    setEditSaved(false);
    setFormError("");
  };

  const startAnotherRequest = () => {
    setReceipt(null);
    setCreateForm(blankRequest());
    setFormError("");
    setEditSaved(false);
    setTab("request");
  };

  const openReceiptTracking = () => {
    if (!receipt) return;
    const code = receipt.trackingCode;
    setTrackingCodeInput(code);
    setTrackError("");
    setTab("track");
    beginLookup(code);
  };

  return (
    <div className="portal-page">
      <header className="portal-header">
        <a className="portal-brand" href="/" aria-label="MOC home">
          MOC
        </a>
      </header>
      <main className="portal-main">
        <section className="portal-intro" aria-labelledby="portal-title">
          <p className="portal-eyebrow">MOC · MINISTRY SERVICES</p>
          <h1 id="portal-title">A little help. A big difference.</h1>
          <p>
            Request creative support for your ministry, or check in on a request
            you’ve already made.
          </p>
        </section>

        <section className="portal-card" aria-label="Request and tracking">
          <Tabs.Root
            value={tab}
            onValueChange={(value) => setTab(value as Tab)}
            className="portal-tabs-root"
          >
            <Tabs.List className="portal-tabs" aria-label="Request options">
              <Tabs.Tab value="request" className="portal-tab">
                Make a request
              </Tabs.Tab>
              <Tabs.Tab value="track" className="portal-tab">
                Track &amp; edit
              </Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="request" className="portal-panel">
              {receipt ? (
                <div className="request-success" role="status">
                  <div className="success-mark">
                    <Check size={22} strokeWidth={2.5} />
                  </div>
                  <p className="success-eyebrow">REQUEST SENT</p>
                  <h2>We’ve got it.</h2>
                  <p className="success-copy">
                    Save this private code to check your request or make changes
                    while it’s pending.
                  </p>
                  {formError && (
                    <div className="portal-error" role="alert">
                      {formError}
                    </div>
                  )}
                  <div className="access-code-wrap">
                    <span className="access-code-label">
                      <LockKeyhole size={15} /> Your private access code
                    </span>
                    <div className="access-code-row">
                      <code className="access-code">
                        {receipt.trackingCode}
                      </code>
                      <button
                        className="copy-button"
                        type="button"
                        onClick={() => void copyCode()}
                        aria-label="Copy private access code"
                      >
                        {copied ? <Check size={17} /> : <Copy size={17} />}
                        <span>{copied ? "Copied" : "Copy"}</span>
                      </button>
                    </div>
                    <span className="code-safety">
                      Anyone with this code can view and edit your request.
                    </span>
                  </div>
                  <div className="success-actions">
                    <button
                      className="button button-primary"
                      type="button"
                      onClick={openReceiptTracking}
                    >
                      Track this request <ArrowRight size={17} />
                    </button>
                    <button
                      className="button button-quiet"
                      type="button"
                      onClick={startAnotherRequest}
                    >
                      Make another request
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="panel-heading">
                    <h2>What do you need?</h2>
                  </div>
                  <RequestForm
                    form={createForm}
                    ministries={ministries}
                    services={orderedServices}
                    selectedService={selectedCreateService}
                    shortNotice={createShortNotice}
                    isEditing={false}
                    busy={submitMutation.isPending}
                    error={formError}
                    onChange={(key, value) =>
                      updateDraft(setCreateForm, key, value)
                    }
                    onSubmit={submitCreateRequest}
                    onCancel={() => {}}
                  />
                </>
              )}
            </Tabs.Panel>

            <Tabs.Panel value="track" className="portal-panel">
              <div className="panel-heading">
                <h2>Find your request</h2>
                <p>
                  Enter the private access code you received after submitting.
                </p>
              </div>
              {trackError && (
                <div className="portal-error" role="alert">
                  {trackError}
                </div>
              )}
              <form className="track-form" onSubmit={trackRequest}>
                <Field
                  label="Private access code"
                  required
                  hint="Your code is private. Anyone with it can view or edit the request."
                >
                  <input
                    className="portal-input code-input"
                    required
                    value={trackingCodeInput}
                    onChange={(event) => {
                      lookupSequence.current += 1;
                      setTrackingCodeInput(event.target.value);
                      setTracking(null);
                      setActiveTrackingCode(null);
                      activeTrackingCodeRef.current = null;
                      setEditForm(blankRequest());
                      setTrackError("");
                      setFormError("");
                      setEditSaved(false);
                    }}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    aria-label="Private access code"
                    placeholder="Enter your 24-character code"
                  />
                </Field>
                <button
                  className="button button-primary track-submit"
                  type="submit"
                  disabled={trackMutation.isPending}
                >
                  {trackMutation.isPending ? "Checking…" : "Find request"}
                  {!trackMutation.isPending && <ArrowRight size={17} />}
                </button>
              </form>
              {tracking && (
                <div className="track-content" aria-live="polite">
                  <TrackingSummary result={tracking} />
                  {tracking.request.status === "pending" ? (
                    <div className="edit-section">
                      <div className="edit-heading">
                        <div>
                          <p className="section-eyebrow">PENDING REQUEST</p>
                          <h3>Make changes</h3>
                        </div>
                        <span className="edit-available">
                          You can edit while pending
                        </span>
                      </div>
                      {editSaved && (
                        <p className="edit-saved" role="status">
                          <Check size={16} /> Changes saved.
                        </p>
                      )}
                      {formError && (
                        <div className="portal-error" role="alert">
                          {formError}
                        </div>
                      )}
                      {activeTrackingCode ? (
                        <RequestForm
                          form={editForm}
                          ministries={ministries}
                          services={orderedServices}
                          selectedService={selectedEditService}
                          shortNotice={editShortNotice}
                          isEditing
                          busy={editMutation.isPending}
                          error={""}
                          onChange={(key, value) =>
                            updateDraft(setEditForm, key, value)
                          }
                          onSubmit={submitEditRequest}
                          onCancel={cancelEdit}
                        />
                      ) : (
                        <RequestDetails request={tracking.request} />
                      )}
                    </div>
                  ) : (
                    <div className="closed-request">
                      <p>Edits are closed for this request.</p>
                      <RequestDetails request={tracking.request} />
                    </div>
                  )}
                </div>
              )}
            </Tabs.Panel>
          </Tabs.Root>
          <div className="portal-card-note">
            <LockKeyhole size={15} /> No account needed. Keep your access code
            somewhere safe.
          </div>
        </section>
      </main>
      <footer className="portal-footer">
        © {new Date().getFullYear()} MOC Ministry Services
      </footer>
    </div>
  );
}

function RequestForm({
  form,
  ministries,
  services,
  selectedService,
  shortNotice,
  isEditing,
  busy,
  error,
  onChange,
  onSubmit,
  onCancel,
}: {
  form: RequestInput;
  ministries: string[];
  services: Service[];
  selectedService?: Service;
  shortNotice: boolean;
  isEditing: boolean;
  busy: boolean;
  error: string;
  onChange: (key: keyof RequestInput, value: string | string[]) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  return (
    <form className="request-form" onSubmit={onSubmit}>
      {error && (
        <div className="portal-error" role="alert">
          {error}
        </div>
      )}
      <div className="form-row">
        <SelectField
          label="Ministry"
          value={form.ministry}
          disabled={isEditing}
          placeholder="Choose a ministry"
          options={ministries.map((ministry) => ({
            value: ministry,
            label: ministry,
          }))}
          onChange={(value) => onChange("ministry", value)}
        />
        <SelectField
          label="Service"
          value={form.service}
          placeholder="Choose a service"
          options={services.map((service) => ({
            value: service.id,
            label: service.name,
          }))}
          onChange={(value) => onChange("service", value)}
        />
      </div>
      <Field label="Request title" required>
        <input
          className="portal-input"
          required
          maxLength={120}
          value={form.title}
          onChange={(event) => onChange("title", event.target.value)}
          placeholder="e.g. Youth retreat recap video"
        />
      </Field>
      <Field label="Detailed instructions" required>
        <textarea
          className="portal-input"
          required
          rows={4}
          value={form.instructions}
          onChange={(event) => onChange("instructions", event.target.value)}
          placeholder="Describe what you need…"
        />
      </Field>
      <Field label="Additional notes" required>
        <textarea
          className="portal-input"
          required
          rows={3}
          value={form.notes}
          onChange={(event) => onChange("notes", event.target.value)}
          placeholder="Anything else we should know?"
        />
      </Field>
      {selectedService?.requiresAiredDates && (
        <div className="aired-dates-block">
          <div className="aired-heading">
            <div>
              <strong>Exact aired dates</strong>
              <span>Needed to find a previously aired video.</span>
            </div>
            <span className="required-pill">REQUIRED</span>
          </div>
          {(form.airedDates ?? []).map((date, index) => (
            <div className="aired-date-row" key={`aired-${index}`}>
              <label className="sr-only" htmlFor={`aired-date-${index}`}>
                Aired date {index + 1}
              </label>
              <input
                id={`aired-date-${index}`}
                type="date"
                max={todayIsoDate()}
                required
                value={date}
                onChange={(event) => {
                  const dates = [...(form.airedDates ?? [])];
                  dates[index] = event.target.value;
                  onChange("airedDates", dates);
                }}
              />
              <button
                className="remove-date"
                type="button"
                aria-label={`Remove aired date ${index + 1}`}
                onClick={() =>
                  onChange(
                    "airedDates",
                    (form.airedDates ?? []).filter((_, i) => i !== index),
                  )
                }
              >
                <X size={16} />
              </button>
            </div>
          ))}
          <button
            className="add-date"
            type="button"
            onClick={() =>
              onChange("airedDates", [...(form.airedDates ?? []), ""])
            }
          >
            <Plus size={15} /> Add exact date
          </button>
        </div>
      )}
      <Field label="Completion date and time" required>
        <span className="datetime-wrap">
          <input
            className="portal-input"
            type="datetime-local"
            required
            value={form.dueAt}
            onChange={(event) => onChange("dueAt", event.target.value)}
          />
          <Clock3 size={17} aria-hidden="true" />
        </span>
      </Field>
      {shortNotice && (
        <div className="short-notice" role="status">
          <Clock3 size={17} />
          <span>
            <strong>Short notice</strong> This is due within 24 hours. We’ll
            confirm what’s possible.
          </span>
        </div>
      )}
      <p className="file-share-note">
        Have files? Share them in your ministry’s Telegram group.
      </p>
      <div className="form-footer">
        <span>
          <b aria-hidden="true">*</b> Required fields
        </span>
        <div className="form-actions">
          {isEditing && (
            <button
              className="button button-secondary"
              type="button"
              onClick={onCancel}
              disabled={busy}
            >
              Revert changes
            </button>
          )}
          <button
            className="button button-primary"
            type="submit"
            disabled={busy}
          >
            {busy ? "Saving…" : isEditing ? "Save changes" : "Send request"}
            {!busy && <ArrowRight size={17} />}
          </button>
        </div>
      </div>
    </form>
  );
}

function TrackingSummary({ result }: { result: PublicTracking }) {
  const { request, task } = result;
  const pending = request.status === "pending";
  const approved = request.status === "approved";
  const progress = task?.progress ?? 0;
  const department =
    task && DEPARTMENTS.find((item) => item.id === task.department)?.name;
  return (
    <section className="tracking-summary">
      <div className="tracking-summary-top">
        <div>
          <p className="section-eyebrow">REQUEST STATUS</p>
          <h3>{request.title}</h3>
        </div>
        <span
          className={`status-badge ${pending ? "status-pending" : approved ? "status-approved" : "status-rejected"}`}
        >
          {pending ? "Awaiting review" : approved ? "Approved" : "Not approved"}
        </span>
      </div>
      <div className="tracking-meta">
        <span>{request.ministry}</span>
        <span>
          {SERVICES.find((service) => service.id === request.service)?.name ??
            request.service.replaceAll("-", " ")}
        </span>
        <span>Due {prettyDate(request.dueAt)}</span>
      </div>
      {request.status === "rejected" ? (
        <>
          <div className="rejection-box">
            <strong>Reason from the team</strong>
            <p>
              {request.rejectionReason ||
                "The team was unable to approve this request."}
            </p>
          </div>
          <div className="progress-meta">
            <span>Work progress</span>
            <strong>Closed</strong>
          </div>
        </>
      ) : (
        <>
          <div className="progress-meta">
            <span>{pending ? "Work progress" : "Progress"}</span>
            <strong>
              {task
                ? progress === 100
                  ? "Complete"
                  : `${progress}% complete`
                : "Not started"}
            </strong>
          </div>
          <div
            className="progress-track"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Work progress"
          >
            <span style={{ width: `${progress}%` }} />
          </div>
          {department && task && (
            <div className="result-assignment">
              <span>ROUTED TO</span>
              <strong>
                {department} · {task.subTeam}
              </strong>
            </div>
          )}
        </>
      )}
      {task?.completedAt && (
        <p className="completed-note">
          Completed {prettyDate(task.completedAt)}.
        </p>
      )}
    </section>
  );
}

function RequestDetails({ request }: { request: PublicRequest }) {
  return (
    <dl className="request-details">
      <div>
        <dt>Ministry</dt>
        <dd>{request.ministry}</dd>
      </div>
      <div>
        <dt>Service</dt>
        <dd>
          {SERVICES.find((service) => service.id === request.service)?.name ??
            request.service.replaceAll("-", " ")}
        </dd>
      </div>
      <div>
        <dt>Completion due</dt>
        <dd>{prettyDate(request.dueAt)}</dd>
      </div>
      <div className="detail-wide">
        <dt>Instructions</dt>
        <dd>{request.instructions}</dd>
      </div>
      <div className="detail-wide">
        <dt>Additional notes</dt>
        <dd>{request.notes}</dd>
      </div>
      {!!request.airedDates?.length && (
        <div className="detail-wide">
          <dt>Exact aired dates</dt>
          <dd>{request.airedDates.join(", ")}</dd>
        </div>
      )}
      {request.rejectionReason && (
        <div className="detail-wide">
          <dt>Reason from the team</dt>
          <dd>{request.rejectionReason}</dd>
        </div>
      )}
    </dl>
  );
}
