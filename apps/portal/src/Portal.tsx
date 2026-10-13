import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Clipboard,
  Clock3,
  ExternalLink,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  DEPARTMENTS,
  MINISTRIES,
  SERVICES,
  type MinistryRequest,
  type PublicTracking,
  type RequestInput,
  type Service,
} from "@moc/shared";
import { api } from "@moc/client";
import { Badge, Button } from "@moc/ui";
import "./styles.css";

type Tab = "submit" | "track";
type Catalog = { services: Service[]; ministries: string[] };
type TrackInput = { reference: string; ministry: string };

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
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";

function BrandMark() {
  return (
    <svg viewBox="0 0 44 44" aria-hidden="true" className="portal-brand-mark">
      <path
        d="M5 36h34M9 33V15l13-8 13 8v18M14 33V17m8 16V13m8 20V17M7 15 22 5l15 10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M19 5h6" stroke="currentColor" strokeWidth="1.65" />
    </svg>
  );
}

function Header() {
  const workspaceUrl =
    import.meta.env.VITE_WORKSPACE_URL || "http://localhost:5173";
  return (
    <header className="portal-header">
      <a className="portal-brand" href="/" aria-label="MOC home">
        <BrandMark />
        <span>
          <strong>MOC</strong>
          <small>MINISTRY PORTAL</small>
        </span>
      </a>
      <nav className="portal-header-nav" aria-label="Main navigation">
        <a href="#how-it-works">How it works</a>
        <a className="portal-workspace-link" href={workspaceUrl}>
          Workspace <ExternalLink size={14} />
        </a>
      </nav>
    </header>
  );
}

function ProcessAside() {
  return (
    <aside className="portal-aside" id="how-it-works">
      <div className="aside-eyebrow">
        <Sparkles size={14} /> SIMPLE BY DESIGN
      </div>
      <h2>Good work starts with a clear request.</h2>
      <p>
        Share what you need and when you need it. Our team will review the
        details and get back to you.
      </p>
      <ol className="process-list">
        <li>
          <span className="process-number">01</span>
          <div>
            <strong>Tell us what you need</strong>
            <p>Choose a service, add the details, and set your deadline.</p>
          </div>
        </li>
        <li>
          <span className="process-number">02</span>
          <div>
            <strong>We review your request</strong>
            <p>We’ll check the request and route it to the right team.</p>
          </div>
        </li>
        <li>
          <span className="process-number">03</span>
          <div>
            <strong>Follow the progress</strong>
            <p>
              Use your reference number to check status or update a pending
              request.
            </p>
          </div>
        </li>
      </ol>
      <div className="aside-note">
        <ShieldCheck size={18} />
        <span>
          Your request reference is private to you. Keep it somewhere safe.
        </span>
      </div>
      <div className="aside-decoration" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </aside>
  );
}

function Field({
  label,
  hint,
  children,
  required = false,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className="portal-field">
      <span className="portal-field-label">
        {label}
        {required && <i aria-hidden="true">*</i>}
      </span>
      {children}
      {hint && <span className="portal-field-hint">{hint}</span>}
    </label>
  );
}

export default function Portal() {
  const [tab, setTab] = useState<Tab>("submit");
  const [form, setForm] = useState<RequestInput>(blankRequest);
  const [trackingForm, setTrackingForm] = useState<TrackInput>({
    reference: "",
    ministry: "",
  });
  const [tracking, setTracking] = useState<PublicTracking | null>(null);
  const [submitted, setSubmitted] = useState<MinistryRequest | null>(null);
  const [submissionWasEdit, setSubmissionWasEdit] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [formError, setFormError] = useState("");
  const [trackError, setTrackError] = useState("");
  const [editing, setEditing] = useState(false);

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
  const selectedService = services.find((item) => item.id === form.service);
  const shortNotice =
    !!form.dueAt &&
    new Date(form.dueAt).getTime() > Date.now() &&
    new Date(form.dueAt).getTime() - Date.now() < 24 * 60 * 60 * 1000;

  const submitMutation = useMutation({
    mutationFn: (input: RequestInput) =>
      api<MinistryRequest>("/api/requests", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (request) => {
      setSubmitted(request);
      setSubmissionWasEdit(false);
      setCopyError("");
      setTrackingForm({
        reference: request.reference,
        ministry: request.ministry,
      });
      setFormError("");
      setEditing(false);
    },
    onError: (error) => setFormError(errorText(error)),
  });
  const trackMutation = useMutation({
    mutationFn: (input: TrackInput) =>
      api<PublicTracking>("/api/track", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (result) => {
      setTracking(result);
      setTrackingForm({
        reference: result.request.reference,
        ministry: result.request.ministry,
      });
      setTrackError("");
      setSubmitted(null);
      setEditing(false);
    },
    onError: (error) => {
      setTracking(null);
      setTrackError(errorText(error));
    },
  });
  const editMutation = useMutation({
    mutationFn: ({
      reference,
      ministry,
      input,
    }: {
      reference: string;
      ministry: string;
      input: RequestInput;
    }) =>
      api<MinistryRequest>(`/api/requests/${encodeURIComponent(reference)}`, {
        method: "PATCH",
        body: JSON.stringify({ ministry, input }),
      }),
    onSuccess: (request) => {
      setTracking((previous) =>
        previous ? { ...previous, request } : previous,
      );
      setSubmitted(request);
      setSubmissionWasEdit(true);
      setCopyError("");
      setEditing(false);
      setFormError("");
    },
    onError: (error) => setFormError(errorText(error)),
  });

  const updateForm = (key: keyof RequestInput, value: string | string[]) =>
    setForm((previous) => ({ ...previous, [key]: value }));
  const cancelEdit = () => {
    setEditing(false);
    setForm(blankRequest());
    setFormError("");
    setSubmitted(null);
  };
  const changeTab = (next: Tab) => {
    if (editing && next !== "submit") cancelEdit();
    setTab(next);
    setFormError("");
    setTrackError("");
    setSubmitted(null);
    setCopyError("");
  };
  const startEdit = () => {
    if (!tracking) return;
    setForm({
      ...tracking.request,
      dueAt: localDateTime(tracking.request.dueAt),
      airedDates: tracking.request.airedDates ?? [],
    });
    setSubmitted(null);
    setFormError("");
    setEditing(true);
    setTab("submit");
  };
  const submitRequest = (event: FormEvent) => {
    event.preventDefault();
    setFormError("");
    const dueDate = new Date(form.dueAt);
    if (!Number.isFinite(dueDate.valueOf())) {
      setFormError("Choose a valid completion date and time.");
      return;
    }
    const input = {
      ...form,
      dueAt: dueDate.toISOString(),
      airedDates: selectedService?.requiresAiredDates
        ? (form.airedDates ?? [])
        : undefined,
    };
    if (dueDate.getTime() <= Date.now()) {
      setFormError("Choose a future date and time for completion.");
      return;
    }
    if (selectedService?.requiresAiredDates && !input.airedDates?.length) {
      setFormError(
        "Add at least one exact aired date to retrieve a previously aired video.",
      );
      return;
    }
    if (editing && tracking)
      editMutation.mutate({
        reference: tracking.request.reference,
        ministry: tracking.request.ministry,
        input,
      });
    else submitMutation.mutate(input);
  };
  const trackRequest = (event: FormEvent) => {
    event.preventDefault();
    setTrackError("");
    trackMutation.mutate({
      reference: trackingForm.reference.trim(),
      ministry: trackingForm.ministry,
    });
  };
  const copyReference = async () => {
    if (!submitted) return;
    setCopyError("");
    try {
      await navigator.clipboard.writeText(submitted.reference);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
      setCopyError(
        "Copy was unavailable. You can select and copy the reference number above.",
      );
    }
  };

  return (
    <div className="portal-page">
      <Header />
      <main>
        <section className="portal-hero">
          <div className="hero-kicker">
            <span /> MOC MINISTRY SERVICES
          </div>
          <h1>
            A little clarity.
            <br />
            <em>A lot of good work.</em>
          </h1>
          <p>
            A simple way to request creative and production support for your
            ministry. No account needed.
          </p>
        </section>
        <section className="portal-main-grid">
          <div className="portal-card">
            <div
              className="portal-tabs"
              role="tablist"
              aria-label="Request options"
            >
              <button
                type="button"
                id="submit-tab"
                role="tab"
                aria-selected={tab === "submit"}
                className={tab === "submit" ? "active" : ""}
                onClick={() => changeTab("submit")}
              >
                Submit a request
              </button>
              <button
                type="button"
                id="track-tab"
                role="tab"
                aria-selected={tab === "track"}
                className={tab === "track" ? "active" : ""}
                onClick={() => changeTab("track")}
              >
                Track a request
              </button>
            </div>
            {catalogQuery.isError && (
              <div className="portal-inline-notice">
                We couldn’t connect to the API. The service list is available;
                reconnect to send your request.
              </div>
            )}
            {tab === "submit" && (
              <div
                role="tabpanel"
                aria-labelledby="submit-tab"
                className="portal-panel"
              >
                {submitted ? (
                  <div className="request-success" role="status">
                    <div className="success-icon">
                      <Check size={22} />
                    </div>
                    <div className="success-eyebrow">
                      {submissionWasEdit
                        ? "REQUEST UPDATED"
                        : "REQUEST RECEIVED"}
                    </div>
                    <h2>
                      {submissionWasEdit
                        ? "Your updates are saved."
                        : "Thank you. We have your request."}
                    </h2>
                    <p>
                      Keep this reference number to check your request at any
                      time.
                    </p>
                    <button
                      type="button"
                      className="reference-copy"
                      onClick={() => void copyReference()}
                      aria-label="Copy request reference"
                    >
                      <span>
                        <small>YOUR REFERENCE</small>
                        <strong>{submitted.reference}</strong>
                      </span>
                      <span className="copy-action">
                        {copied ? (
                          <>
                            <Check size={15} /> Copied
                          </>
                        ) : (
                          <>
                            <Clipboard size={15} /> Copy
                          </>
                        )}
                      </span>
                    </button>
                    {copyError && (
                      <div className="portal-inline-notice" role="status">
                        {copyError}
                      </div>
                    )}
                    <Button
                      variant="primary"
                      className="success-track-button"
                      onClick={() => {
                        setSubmitted(null);
                        setTab("track");
                        setTrackingForm({
                          reference: submitted.reference,
                          ministry: submitted.ministry,
                        });
                        trackMutation.mutate({
                          reference: submitted.reference,
                          ministry: submitted.ministry,
                        });
                      }}
                    >
                      Track this request <ArrowRight size={16} />
                    </Button>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => {
                        setSubmitted(null);
                        setEditing(false);
                        setForm(blankRequest());
                      }}
                    >
                      Submit another request
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="panel-heading">
                      <span className="panel-step">01 / REQUEST DETAILS</span>
                      <h2>
                        {editing
                          ? "Update your request"
                          : "Tell us what you need."}
                      </h2>
                      <p>Required fields help us plan and respond well.</p>
                    </div>
                    {editing && (
                      <div className="editing-notice">
                        Editing <strong>{tracking?.request.reference}</strong>.
                        Updates are available while your request is awaiting
                        review.
                      </div>
                    )}
                    {formError && (
                      <div className="portal-error" role="alert">
                        {formError}
                      </div>
                    )}
                    <form className="request-form" onSubmit={submitRequest}>
                      <div className="form-row">
                        <Field label="Ministry" required>
                          <span
                            className={`select-wrap ${editing ? "select-disabled" : ""}`}
                          >
                            <select
                              required
                              disabled={editing}
                              value={form.ministry}
                              onChange={(event) =>
                                updateForm("ministry", event.target.value)
                              }
                            >
                              <option value="">Choose a ministry</option>
                              {ministries.map((ministry) => (
                                <option key={ministry} value={ministry}>
                                  {ministry}
                                </option>
                              ))}
                            </select>
                            <ChevronDown size={16} />
                          </span>
                        </Field>
                        <Field label="Service" required>
                          <span className="select-wrap">
                            <select
                              required
                              value={form.service}
                              onChange={(event) =>
                                updateForm("service", event.target.value)
                              }
                            >
                              <option value="">Choose a service</option>
                              {orderedServices.map((service) => (
                                <option key={service.id} value={service.id}>
                                  {service.name}
                                </option>
                              ))}
                            </select>
                            <ChevronDown size={16} />
                          </span>
                        </Field>
                      </div>
                      <Field
                        label="Request title"
                        required
                        hint="A short title that helps us recognise your request."
                      >
                        <input
                          required
                          maxLength={120}
                          value={form.title}
                          onChange={(event) =>
                            updateForm("title", event.target.value)
                          }
                          placeholder="e.g. Youth retreat recap video"
                        />
                      </Field>
                      <Field
                        label="Detailed instructions"
                        required
                        hint="Include the purpose, audience, key details, and anything the team should know."
                      >
                        <textarea
                          required
                          rows={4}
                          value={form.instructions}
                          onChange={(event) =>
                            updateForm("instructions", event.target.value)
                          }
                          placeholder="Describe what you have in mind…"
                        />
                      </Field>
                      <Field
                        label="Additional notes"
                        required
                        hint="Add context, references, or practical details. If you have files, please share them through your ministry’s Telegram group."
                      >
                        <textarea
                          required
                          rows={3}
                          value={form.notes}
                          onChange={(event) =>
                            updateForm("notes", event.target.value)
                          }
                          placeholder="Anything else that would be helpful?"
                        />
                      </Field>
                      {selectedService?.requiresAiredDates && (
                        <div className="aired-dates-block">
                          <div className="aired-title">
                            <div>
                              <strong>
                                Exact aired date
                                {(form.airedDates?.length ?? 0) !== 1
                                  ? "s"
                                  : ""}
                              </strong>
                              <span>
                                Required to find previously aired video. Add
                                each date you know.
                              </span>
                            </div>
                            <span className="required-pill">REQUIRED</span>
                          </div>
                          {(form.airedDates ?? []).map((date, index) => (
                            <div
                              className="aired-date-row"
                              key={`aired-${index}`}
                            >
                              <label
                                className="sr-only"
                                htmlFor={`aired-date-${index}`}
                              >
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
                                  updateForm("airedDates", dates);
                                }}
                              />
                              <button
                                type="button"
                                className="remove-date"
                                aria-label={`Remove aired date ${index + 1}`}
                                onClick={() =>
                                  updateForm(
                                    "airedDates",
                                    (form.airedDates ?? []).filter(
                                      (_, i) => i !== index,
                                    ),
                                  )
                                }
                              >
                                ×
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            className="add-date"
                            onClick={() =>
                              updateForm("airedDates", [
                                ...(form.airedDates ?? []),
                                "",
                              ])
                            }
                          >
                            + Add another exact date
                          </button>
                        </div>
                      )}
                      <Field
                        label="Completion date and time"
                        required
                        hint="Please include both the date and time you need this completed by."
                      >
                        <span className="datetime-wrap">
                          <input
                            type="datetime-local"
                            required
                            value={form.dueAt}
                            onChange={(event) =>
                              updateForm("dueAt", event.target.value)
                            }
                          />
                          <Clock3 size={16} />
                        </span>
                      </Field>
                      {shortNotice && (
                        <div className="short-notice" role="status">
                          <Clock3 size={16} />
                          <span>
                            <strong>Short notice</strong> This request is due
                            within 24 hours. We’ll do our best to help, and will
                            confirm what’s possible.
                          </span>
                        </div>
                      )}
                      <div className="form-footer">
                        <span>
                          <i aria-hidden="true">*</i> Required fields
                        </span>
                        <div className="form-footer-actions">
                          {editing && (
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={cancelEdit}
                            >
                              Cancel edit
                            </Button>
                          )}
                          <Button
                            variant="primary"
                            type="submit"
                            disabled={
                              submitMutation.isPending || editMutation.isPending
                            }
                          >
                            {submitMutation.isPending || editMutation.isPending
                              ? "Sending…"
                              : editing
                                ? "Save updates"
                                : "Send request"}
                            <ArrowRight size={16} />
                          </Button>
                        </div>
                      </div>
                    </form>
                  </>
                )}
              </div>
            )}
            {tab === "track" && (
              <div
                role="tabpanel"
                aria-labelledby="track-tab"
                className="portal-panel track-panel"
              >
                <div className="panel-heading">
                  <span className="panel-step">02 / REQUEST STATUS</span>
                  <h2>Let’s find your request.</h2>
                  <p>
                    Enter the reference number and ministry used when
                    submitting.
                  </p>
                </div>
                {trackError && (
                  <div className="portal-error" role="alert">
                    {trackError}
                  </div>
                )}
                <form className="track-form" onSubmit={trackRequest}>
                  <Field
                    label="Request reference"
                    required
                    hint="For example, MOC-2026-0001"
                  >
                    <input
                      required
                      value={trackingForm.reference}
                      onChange={(event) =>
                        setTrackingForm({
                          ...trackingForm,
                          reference: event.target.value.toUpperCase(),
                        })
                      }
                      placeholder="MOC-YYYY-0000"
                      autoCapitalize="characters"
                    />
                  </Field>
                  <Field label="Ministry" required>
                    <span className="select-wrap">
                      <select
                        required
                        value={trackingForm.ministry}
                        onChange={(event) =>
                          setTrackingForm({
                            ...trackingForm,
                            ministry: event.target.value,
                          })
                        }
                      >
                        <option value="">Choose a ministry</option>
                        {ministries.map((ministry) => (
                          <option key={ministry} value={ministry}>
                            {ministry}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={16} />
                    </span>
                  </Field>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={trackMutation.isPending}
                  >
                    {trackMutation.isPending ? "Looking…" : "Find my request"}
                    <Search size={16} />
                  </Button>
                </form>
                {tracking && (
                  <TrackingResult result={tracking} onEdit={startEdit} />
                )}
              </div>
            )}
          </div>
          <ProcessAside />
        </section>
      </main>
      <footer className="portal-footer">
        <span>© {new Date().getFullYear()} MOC Ministry Services</span>
        <span>Made for ministries, with care.</span>
      </footer>
    </div>
  );
}

function TrackingResult({
  result,
  onEdit,
}: {
  result: PublicTracking;
  onEdit: () => void;
}) {
  const { request, task } = result;
  const statusTone =
    request.status === "approved"
      ? "green"
      : request.status === "rejected"
        ? "red"
        : "gold";
  const statusLabel =
    request.status === "approved"
      ? "Approved"
      : request.status === "rejected"
        ? "Not approved"
        : "Awaiting review";
  const progressLabel = task
    ? task.progress === 100
      ? "Complete"
      : `${task.progress}% complete`
    : request.status === "rejected"
      ? "Closed"
      : "Not started";
  return (
    <section className="tracking-result" aria-live="polite">
      <div className="result-topline">
        <span>REQUEST FOUND</span>
        <Badge tone={statusTone}>{statusLabel}</Badge>
      </div>
      <h3>{request.title}</h3>
      <div className="result-ref">
        {request.reference} <span>·</span> {request.ministry}
      </div>
      {request.status === "rejected" ? (
        <div className="rejection-box">
          <strong>Reason shared by the team</strong>
          <p>
            {request.rejectionReason ||
              "The team was unable to approve this request."}
          </p>
        </div>
      ) : (
        <>
          <div className="progress-meta">
            <span>Work progress</span>
            <strong>{progressLabel}</strong>
          </div>
          <div
            className="progress-track"
            aria-label={`Progress ${task?.progress ?? 0}%`}
          >
            <span style={{ width: `${task?.progress ?? 0}%` }} />
          </div>
          {task && (
            <div className="result-assignment">
              <span>ROUTED TO</span>
              <strong>
                {
                  DEPARTMENTS.find(
                    (department) => department.id === task.department,
                  )?.name
                }{" "}
                · {task.subTeam}
              </strong>
            </div>
          )}
        </>
      )}
      <div className="result-details">
        <div>
          <span>Completion due</span>
          <strong>{prettyDate(request.dueAt)}</strong>
        </div>
        <div>
          <span>Service</span>
          <strong>
            {SERVICES.find((service) => service.id === request.service)?.name ??
              request.service.replaceAll("-", " ")}
          </strong>
        </div>
      </div>
      <div className="result-request-details">
        <strong>Your instructions</strong>
        <p>{request.instructions}</p>
        <strong>Additional notes</strong>
        <p>{request.notes}</p>
        {request.airedDates?.length ? (
          <>
            <strong>Exact aired dates</strong>
            <p>{request.airedDates.join(", ")}</p>
          </>
        ) : null}
      </div>
      {request.status === "pending" && (
        <div className="result-actions">
          <span>Need to change a detail?</span>
          <Button variant="secondary" size="sm" onClick={onEdit}>
            Edit request <ArrowRight size={15} />
          </Button>
        </div>
      )}
      {task?.completedAt && (
        <p className="completed-note">
          Completed {prettyDate(task.completedAt)}.
        </p>
      )}
    </section>
  );
}
