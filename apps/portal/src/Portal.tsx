import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Check,
  ChevronRight,
  ChevronDown,
  CircleAlert,
  Clock3,
  Copy,
  FileText,
  LockKeyhole,
  Plus,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  type Catalog,
  type PublicRequest,
  type PublicTracking,
  type RequestInput,
  type Service,
  type SubmissionReceipt,
} from "@moc/shared";
import { api, ApiError } from "@moc/client";
import "./styles.css";

type Screen = "home" | "request" | "track";
type CatalogStatus = "loading" | "error" | "empty";

type FieldKey =
  | "ministry"
  | "service"
  | "title"
  | "instructions"
  | "notes"
  | "airedDates"
  | "dueAt";
type FieldErrors = Partial<Record<FieldKey, string>>;

const fieldMessageId = (controlId: string, kind: "hint" | "error") =>
  `${controlId}-${kind}`;

const fieldDescribedBy = (controlId: string, error?: string, hint?: string) =>
  error
    ? fieldMessageId(controlId, "error")
    : hint
      ? fieldMessageId(controlId, "hint")
      : undefined;

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
  controlId,
  children,
  required = false,
  hint,
  error,
}: {
  label: string;
  controlId: string;
  children: ReactNode;
  required?: boolean;
  hint?: string;
  error?: string;
}) {
  return (
    <div className="portal-field" data-invalid={error ? "true" : undefined}>
      <label className="portal-field-label" htmlFor={controlId}>
        {label}
        {required && (
          <span className="required-mark" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children}
      {error ? (
        <span
          className="portal-field-error"
          id={fieldMessageId(controlId, "error")}
          role="alert"
        >
          <CircleAlert size={14} aria-hidden="true" />
          {error}
        </span>
      ) : (
        hint && (
          <span
            className="portal-field-hint"
            id={fieldMessageId(controlId, "hint")}
          >
            {hint}
          </span>
        )
      )}
    </div>
  );
}

function SelectField({
  label,
  name,
  value,
  options,
  placeholder,
  disabled = false,
  required = true,
  error,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  options: { value: string; label: string }[];
  placeholder: string;
  disabled?: boolean;
  required?: boolean;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label} controlId={name} required={required} error={error}>
      <span className={`select-wrap${disabled ? " is-disabled" : ""}`}>
        <select
          id={name}
          name={name}
          required={required}
          disabled={disabled}
          value={value}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={fieldDescribedBy(name, error)}
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

function validateDraft(
  draft: RequestInput,
  service?: Service,
): { input?: RequestInput; fieldErrors: FieldErrors } {
  const fieldErrors: FieldErrors = {};
  if (!draft.service) fieldErrors.service = "Choose a request type.";
  if (!draft.ministry) fieldErrors.ministry = "Choose a ministry.";
  if (!draft.title.trim())
    fieldErrors.title = "Add a short title for this request.";
  if (!draft.instructions.trim())
    fieldErrors.instructions = "Describe what you need.";
  if (!draft.notes.trim())
    fieldErrors.notes = "Add a note, even if it’s brief.";
  if (service?.requiresAiredDates && !(draft.airedDates ?? []).some(Boolean)) {
    fieldErrors.airedDates =
      "Add at least one exact aired date to retrieve a previously aired video.";
  }
  const dueDate = new Date(draft.dueAt);
  if (!draft.dueAt || !Number.isFinite(dueDate.valueOf())) {
    fieldErrors.dueAt = "Choose a valid completion date and time.";
  } else if (dueDate.getTime() <= Date.now()) {
    fieldErrors.dueAt = "Choose a future date and time for completion.";
  }
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };
  return {
    fieldErrors,
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
  const [screen, setScreen] = useState<Screen>("home");
  const [createStep, setCreateStep] = useState(1);
  const [createForm, setCreateForm] = useState<RequestInput>(blankRequest);
  const [editForm, setEditForm] = useState<RequestInput>(blankRequest);
  const [createFieldErrors, setCreateFieldErrors] = useState<FieldErrors>({});
  const [editFieldErrors, setEditFieldErrors] = useState<FieldErrors>({});
  const [trackingCodeInput, setTrackingCodeInput] = useState("");
  const [tracking, setTracking] = useState<PublicTracking | null>(null);
  const [receipt, setReceipt] = useState<SubmissionReceipt | null>(null);
  const [activeTrackingCode, setActiveTrackingCode] = useState<string | null>(
    null,
  );
  const [editSaved, setEditSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [formError, setFormError] = useState("");
  const [trackError, setTrackError] = useState("");
  const [validationFocusRequest, setValidationFocusRequest] = useState<{
    field: FieldKey;
    sequence: number;
  } | null>(null);
  const lookupSequence = useRef(0);
  const validationFocusSequence = useRef(0);
  const activeTrackingCodeRef = useRef<string | null>(null);
  const requestStepHeadingRef = useRef<HTMLHeadingElement>(null);
  const copyFallbackRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (screen === "request" && !receipt)
      requestStepHeadingRef.current?.focus();
  }, [screen, createStep, receipt]);

  useEffect(() => {
    if (!validationFocusRequest) return;
    const { field } = validationFocusRequest;
    const targetId = field === "airedDates" ? "aired-date-0" : field;
    const target =
      document.getElementById(targetId) ??
      (field === "airedDates"
        ? document.getElementById("add-aired-date")
        : null);
    target?.focus();
    setValidationFocusRequest(null);
  }, [validationFocusRequest]);

  useEffect(() => {
    if (copyFailed) copyFallbackRef.current?.select();
  }, [copyFailed]);

  const catalogQuery = useQuery({
    queryKey: ["public-catalog"],
    queryFn: () => api<Catalog>("/api/catalog"),
    staleTime: 5 * 60 * 1000,
  });

  const services = catalogQuery.data?.services ?? [];
  const ministries = useMemo(
    () =>
      (catalogQuery.data?.ministries ?? [])
        .slice()
        .sort((a, b) => a.localeCompare(b)),
    [catalogQuery.data?.ministries],
  );
  const departments = catalogQuery.data?.departments ?? [];
  const catalogAvailable =
    !!catalogQuery.data &&
    ministries.length > 0 &&
    services.length > 0 &&
    departments.length > 0;
  const catalogStatus: CatalogStatus | null = catalogAvailable
    ? null
    : catalogQuery.isLoading || catalogQuery.isFetching
      ? "loading"
      : catalogQuery.isError
        ? "error"
        : catalogQuery.data
          ? "empty"
          : "loading";
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
      setCopyFailed(false);
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
      setEditFieldErrors({});
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
    setErrors: typeof setCreateFieldErrors,
    key: keyof RequestInput,
    value: string | string[],
  ) => {
    setEditSaved(false);
    setFormError("");
    setErrors((previous) => {
      if (!(key in previous) && key !== "service") return previous;
      const next = { ...previous };
      delete next[key as FieldKey];
      if (key === "service") delete next.airedDates;
      return next;
    });
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
    if (!catalogAvailable) {
      setCreateStep(1);
      setFormError("");
      return;
    }
    const { input, fieldErrors } = validateDraft(
      createForm,
      selectedCreateService,
    );
    setCreateFieldErrors(fieldErrors);
    if (!input) {
      setFormError("Check the highlighted fields and try again.");
      const firstError = Object.keys(fieldErrors)[0] as FieldKey | undefined;
      setCreateStep(1);
      if (firstError)
        setValidationFocusRequest({
          field: firstError,
          sequence: ++validationFocusSequence.current,
        });
      return;
    }
    setFormError("");
    submitMutation.mutate(input);
  };

  const validateCreateForm = () => {
    const { fieldErrors } = validateDraft(createForm, selectedCreateService);
    setCreateFieldErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) {
      setFormError("Check the highlighted fields and try again.");
      const firstError = Object.keys(fieldErrors)[0] as FieldKey | undefined;
      if (firstError)
        setValidationFocusRequest({
          field: firstError,
          sequence: ++validationFocusSequence.current,
        });
      return false;
    }
    setFormError("");
    return true;
  };

  const submitCreateStep = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!catalogAvailable) {
      setCreateStep(1);
      setFormError("");
      return;
    }
    if (createStep === 2) {
      submitCreateRequest(event);
      return;
    }
    if (validateCreateForm()) setCreateStep(2);
  };

  const submitEditRequest = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
    const { input, fieldErrors } = validateDraft(editForm, selectedEditService);
    setEditFieldErrors(fieldErrors);
    if (!input) {
      setFormError("Check the highlighted fields and try again.");
      const firstError = Object.keys(fieldErrors)[0] as FieldKey | undefined;
      if (firstError)
        setValidationFocusRequest({
          field: firstError,
          sequence: ++validationFocusSequence.current,
        });
      return;
    }
    setFormError("");
    editMutation.mutate({ code: activeTrackingCode, input });
  };

  const beginLookup = (code: string) => {
    const id = ++lookupSequence.current;
    setTracking(null);
    setEditForm(blankRequest());
    setEditFieldErrors({});
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
      setCopyFailed(true);
      setFormError(
        "Copy is unavailable here. The code is selected below; copy it using your device’s usual command.",
      );
    }
  };

  const cancelEdit = () => {
    if (!tracking) return;
    setEditForm({
      ...tracking.request,
      dueAt: localDateTime(tracking.request.dueAt),
      airedDates: tracking.request.airedDates ?? [],
    });
    setEditFieldErrors({});
    setEditSaved(false);
    setFormError("");
  };

  const startAnotherRequest = () => {
    setReceipt(null);
    setCreateForm(blankRequest());
    setCreateFieldErrors({});
    setFormError("");
    setEditSaved(false);
    setCopyFailed(false);
    setCreateStep(1);
    setScreen("request");
  };

  const openReceiptTracking = () => {
    if (!receipt) return;
    const code = receipt.trackingCode;
    setTrackingCodeInput(code);
    setTrackError("");
    setScreen("track");
    beginLookup(code);
  };

  const startRequest = () => {
    setScreen("request");
    setCreateStep(1);
    setCreateFieldErrors({});
    setFormError("");
  };

  const startTracking = () => setScreen("track");

  const handleFlowBack = () => {
    if (screen === "request" && createStep > 1 && !receipt) {
      setCreateStep((step) => step - 1);
      return;
    }
    setScreen("home");
  };

  return (
    <div className={`portal-page portal-page-${screen}`}>
      {screen === "home" && (
        <img
          className="portal-background"
          src="/assets/light/background-sky.avif"
          alt=""
          aria-hidden="true"
        />
      )}
      <a className="portal-skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="portal-header">
        <div className="portal-header-inner">
          <button
            className="portal-brand"
            type="button"
            onClick={() => setScreen("home")}
            aria-label="MOC home"
          >
            <span className="portal-logo-wrap">
              <img src="/logo.svg" alt="" width="40" height="40" />
            </span>
            <span>MOC</span>
          </button>
          {screen !== "home" && (
            <button
              className="portal-close"
              type="button"
              onClick={() => setScreen("home")}
              aria-label="Go to home page"
            >
              <X size={22} aria-hidden="true" />
            </button>
          )}
        </div>
      </header>

      <main className="portal-main" id="main-content" tabIndex={-1}>
        {screen === "home" && (
          <section className="portal-home" aria-labelledby="portal-title">
            <h1 id="portal-title">MOC Request Portal</h1>
            <div className="portal-options">
              <button
                className="portal-option-card"
                type="button"
                onClick={startRequest}
              >
                <span className="portal-option-icon">
                  <img
                    src="/assets/light/icon_inbox.avif"
                    alt=""
                    width="64"
                    height="64"
                  />
                </span>
                <span className="portal-option-copy">
                  <strong>Make a request</strong>
                  <span>
                    Submit a new production or media request with full details.
                  </span>
                </span>
                <ChevronRight size={18} aria-hidden="true" />
              </button>
              <button
                className="portal-option-card"
                type="button"
                onClick={startTracking}
              >
                <span className="portal-option-icon">
                  <img
                    src="/assets/light/icon_folder.avif"
                    alt=""
                    width="64"
                    height="64"
                  />
                </span>
                <span className="portal-option-copy">
                  <strong>Track a submission</strong>
                  <span>Look up the status of an existing request.</span>
                </span>
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </div>
          </section>
        )}

        {screen === "request" && (
          <>
            <header className="flow-header">
              <button
                className="flow-back"
                type="button"
                onClick={handleFlowBack}
              >
                <ArrowLeft size={18} aria-hidden="true" /> Back
              </button>
              <h1>{receipt ? "Submission received" : "New request"}</h1>
              <span aria-hidden="true" />
            </header>
            <div className="request-flow-content">
              {receipt ? (
                <div className="request-success" role="status">
                  <div className="success-mark">
                    <Check size={22} strokeWidth={2.5} />
                  </div>
                  <p className="success-eyebrow">REQUEST SENT</p>
                  <h2>We’ve got it.</h2>
                  <p className="success-copy">
                    Your request is in. Save this code to check in or edit while
                    it’s pending.
                  </p>
                  {formError && (
                    <div className="portal-error" role="alert">
                      <CircleAlert size={16} aria-hidden="true" />
                      <span>{formError}</span>
                    </div>
                  )}
                  <div className="access-code-wrap">
                    <span className="access-code-label">
                      <LockKeyhole size={15} /> Your access code
                    </span>
                    <div className="access-code-row">
                      <code className="access-code">
                        {receipt.trackingCode}
                      </code>
                      <button
                        className="button button-secondary copy-button"
                        type="button"
                        onClick={() => void copyCode()}
                        aria-label="Copy private access code"
                      >
                        {copied ? <Check size={17} /> : <Copy size={17} />}
                        <span>{copied ? "Copied" : "Copy"}</span>
                      </button>
                    </div>
                    {copyFailed && (
                      <textarea
                        ref={copyFallbackRef}
                        className="access-code-fallback"
                        aria-label="Private access code for manual copying"
                        readOnly
                        rows={2}
                        value={receipt.trackingCode}
                        onFocus={(event) => event.currentTarget.select()}
                      />
                    )}
                    <span className="code-safety">
                      <ShieldCheck size={14} aria-hidden="true" />
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
                      className="button button-secondary"
                      type="button"
                      onClick={startAnotherRequest}
                    >
                      Make another request
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div
                    className="request-progress"
                    role="img"
                    aria-label={`Request steps, step ${createStep} of 2`}
                  >
                    {[1, 2].map((step) => (
                      <span
                        key={step}
                        data-active={step <= createStep ? "true" : undefined}
                      />
                    ))}
                  </div>
                  <h2
                    className="request-step-heading"
                    ref={requestStepHeadingRef}
                    tabIndex={-1}
                    aria-live="polite"
                  >
                    {createStep === 1
                      ? "Step 1: Request details"
                      : "Step 2: Review and confirm"}
                  </h2>
                  <RequestForm
                    form={createForm}
                    ministries={ministries}
                    services={orderedServices}
                    selectedService={selectedCreateService}
                    catalogStatus={catalogStatus}
                    catalogRetrying={catalogQuery.isFetching}
                    canSubmit={catalogAvailable}
                    onRetryCatalog={() => void catalogQuery.refetch()}
                    shortNotice={createShortNotice}
                    isEditing={false}
                    busy={submitMutation.isPending}
                    error={formError}
                    fieldErrors={createFieldErrors}
                    step={createStep}
                    onChange={(key, value) =>
                      updateDraft(
                        setCreateForm,
                        setCreateFieldErrors,
                        key,
                        value,
                      )
                    }
                    onSubmit={submitCreateStep}
                    onCancel={handleFlowBack}
                  />
                </>
              )}
            </div>
          </>
        )}

        {screen === "track" && (
          <>
            <header className="flow-header">
              <button
                className="flow-back"
                type="button"
                onClick={handleFlowBack}
              >
                <ArrowLeft size={18} aria-hidden="true" /> Back
              </button>
              <div className="flow-title">
                <h1>Track submission</h1>
                <p>
                  Enter your tracking code to view the status of your request.
                </p>
              </div>
              <span aria-hidden="true" />
            </header>
            <section className="track-content-wrap">
              {trackError && (
                <div className="portal-error" role="alert">
                  <CircleAlert size={16} aria-hidden="true" />
                  <span>{trackError}</span>
                </div>
              )}
              <form className="track-form" onSubmit={trackRequest}>
                <Field
                  label="Private access code"
                  controlId="tracking-code"
                  required
                >
                  <input
                    className="portal-input code-input"
                    id="tracking-code"
                    name="tracking-code"
                    required
                    value={trackingCodeInput}
                    onChange={(event) => {
                      lookupSequence.current += 1;
                      setTrackingCodeInput(event.target.value);
                      setTracking(null);
                      setActiveTrackingCode(null);
                      activeTrackingCodeRef.current = null;
                      setEditForm(blankRequest());
                      setEditFieldErrors({});
                      setTrackError("");
                      setFormError("");
                      setEditSaved(false);
                    }}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    placeholder="MOC-XXXXXX-XXXXXX-XXXXXX-XXXXXX"
                    aria-describedby={fieldDescribedBy("tracking-code")}
                  />
                </Field>
                <button
                  className="button button-primary track-submit"
                  type="submit"
                  disabled={trackMutation.isPending}
                >
                  {trackMutation.isPending ? "Checking…" : "Search"}
                </button>
              </form>
              {tracking && (
                <div className="track-content" aria-live="polite">
                  <TrackingSummary
                    result={tracking}
                    services={services}
                    departments={departments}
                  />
                  {tracking.request.status === "pending" ? (
                    <div className="edit-section">
                      <div className="edit-heading">
                        <h2>Make changes</h2>
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
                          <CircleAlert size={16} aria-hidden="true" />
                          <span>{formError}</span>
                        </div>
                      )}
                      {activeTrackingCode ? (
                        <RequestForm
                          form={editForm}
                          ministries={ministries}
                          services={orderedServices}
                          selectedService={selectedEditService}
                          canSubmit
                          shortNotice={editShortNotice}
                          isEditing
                          busy={editMutation.isPending}
                          error=""
                          fieldErrors={editFieldErrors}
                          onChange={(key, value) =>
                            updateDraft(
                              setEditForm,
                              setEditFieldErrors,
                              key,
                              value,
                            )
                          }
                          onSubmit={submitEditRequest}
                          onCancel={cancelEdit}
                        />
                      ) : (
                        <RequestDetails
                          request={tracking.request}
                          services={services}
                        />
                      )}
                    </div>
                  ) : (
                    <div className="closed-request">
                      <p>Edits are closed for this request.</p>
                      <RequestDetails
                        request={tracking.request}
                        services={services}
                      />
                    </div>
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function RequestForm({
  form,
  ministries,
  services,
  selectedService,
  catalogStatus = null,
  catalogRetrying = false,
  canSubmit = true,
  onRetryCatalog,
  shortNotice,
  isEditing,
  busy,
  error,
  fieldErrors,
  step = 1,
  onChange,
  onSubmit,
  onCancel,
}: {
  form: RequestInput;
  ministries: string[];
  services: Service[];
  selectedService?: Service;
  catalogStatus?: CatalogStatus | null;
  catalogRetrying?: boolean;
  canSubmit?: boolean;
  onRetryCatalog?: () => void;
  shortNotice: boolean;
  isEditing: boolean;
  busy: boolean;
  error: string;
  fieldErrors: FieldErrors;
  step?: number;
  onChange: (key: keyof RequestInput, value: string | string[]) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  return (
    <form
      className="request-form"
      data-editing={isEditing ? "true" : "false"}
      data-step={step}
      data-has-error={error ? "true" : "false"}
      onSubmit={onSubmit}
      noValidate
    >
      {catalogStatus && (
        <div
          className="catalog-state"
          role={catalogStatus === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          <span>
            {catalogStatus === "loading"
              ? "Loading request options…"
              : catalogStatus === "error"
                ? "We couldn’t load request options."
                : "No request options are available yet."}
          </span>
          {catalogStatus !== "loading" && onRetryCatalog && (
            <button
              className="catalog-retry"
              type="button"
              onClick={onRetryCatalog}
              disabled={catalogRetrying}
            >
              {catalogRetrying ? "Retrying…" : "Retry"}
            </button>
          )}
        </div>
      )}
      {error && (
        <div className="portal-error" role="alert">
          <CircleAlert size={16} aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {(isEditing || step === 1) && (
        <div className="form-section request-basics">
          {isEditing && (
            <div className="form-section-heading">
              <FileText size={16} aria-hidden="true" />
              <h3>What you need</h3>
            </div>
          )}
          <div className="form-row">
            <SelectField
              label="Request type"
              name="service"
              value={form.service}
              disabled={services.length === 0}
              placeholder="Choose a request type"
              options={services.map((service) => ({
                value: service.id,
                label: service.name,
              }))}
              error={fieldErrors.service}
              onChange={(value) => onChange("service", value)}
            />
            <SelectField
              label="Ministry"
              name="ministry"
              value={form.ministry}
              disabled={isEditing || ministries.length === 0}
              placeholder="Choose a ministry"
              options={ministries.map((ministry) => ({
                value: ministry,
                label: ministry,
              }))}
              error={fieldErrors.ministry}
              onChange={(value) => onChange("ministry", value)}
            />
          </div>
          <Field
            label="Request title"
            controlId="title"
            required
            error={fieldErrors.title}
          >
            <input
              className="portal-input"
              id="title"
              name="title"
              required
              maxLength={120}
              value={form.title}
              aria-invalid={fieldErrors.title ? "true" : undefined}
              aria-describedby={fieldDescribedBy("title", fieldErrors.title)}
              onChange={(event) => onChange("title", event.target.value)}
              placeholder="e.g. Youth retreat recap video"
            />
          </Field>
        </div>
      )}

      {(isEditing || step === 1) && (
        <div className="form-section request-details-section">
          {isEditing && (
            <div className="form-section-heading">
              <FileText size={16} aria-hidden="true" />
              <h3>Request details</h3>
            </div>
          )}
          <div className="form-row details-fields">
            <Field
              label="Detailed instructions"
              controlId="instructions"
              required
              error={fieldErrors.instructions}
            >
              <textarea
                className="portal-input"
                id="instructions"
                name="instructions"
                required
                rows={4}
                value={form.instructions}
                aria-invalid={fieldErrors.instructions ? "true" : undefined}
                aria-describedby={fieldDescribedBy(
                  "instructions",
                  fieldErrors.instructions,
                )}
                onChange={(event) =>
                  onChange("instructions", event.target.value)
                }
                placeholder="Describe what you need…"
              />
            </Field>
            <Field
              label="Additional notes"
              controlId="notes"
              required
              error={fieldErrors.notes}
            >
              <textarea
                className="portal-input"
                id="notes"
                name="notes"
                required
                rows={3}
                value={form.notes}
                aria-invalid={fieldErrors.notes ? "true" : undefined}
                aria-describedby={fieldDescribedBy("notes", fieldErrors.notes)}
                onChange={(event) => onChange("notes", event.target.value)}
                placeholder="Anything else we should know?"
              />
            </Field>
          </div>
          {selectedService?.requiresAiredDates && (
            <fieldset
              className="aired-dates-block"
              data-invalid={fieldErrors.airedDates ? "true" : undefined}
              aria-invalid={fieldErrors.airedDates ? "true" : undefined}
              aria-describedby={
                fieldErrors.airedDates
                  ? fieldMessageId("aired-dates", "error")
                  : fieldMessageId("aired-dates", "hint")
              }
            >
              <legend className="aired-heading">
                <div>
                  <strong>Exact aired dates</strong>
                  <span id={fieldMessageId("aired-dates", "hint")}>
                    Needed to find a previously aired video.
                  </span>
                </div>
                <span className="required-pill">REQUIRED</span>
              </legend>
              {(form.airedDates ?? []).map((date, index) => (
                <div className="aired-date-row" key={`aired-${index}`}>
                  <label className="sr-only" htmlFor={`aired-date-${index}`}>
                    Aired date {index + 1}
                  </label>
                  <input
                    id={`aired-date-${index}`}
                    type="date"
                    name="airedDates"
                    max={todayIsoDate()}
                    required
                    value={date}
                    aria-invalid={fieldErrors.airedDates ? "true" : undefined}
                    aria-describedby={
                      fieldErrors.airedDates
                        ? fieldMessageId("aired-dates", "error")
                        : fieldMessageId("aired-dates", "hint")
                    }
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
                id="add-aired-date"
                type="button"
                aria-describedby={
                  fieldErrors.airedDates
                    ? fieldMessageId("aired-dates", "error")
                    : fieldMessageId("aired-dates", "hint")
                }
                onClick={() =>
                  onChange("airedDates", [...(form.airedDates ?? []), ""])
                }
              >
                <Plus size={15} /> Add exact date
              </button>
              {fieldErrors.airedDates && (
                <span
                  className="portal-field-error"
                  id={fieldMessageId("aired-dates", "error")}
                  role="alert"
                >
                  <CircleAlert size={14} aria-hidden="true" />
                  {fieldErrors.airedDates}
                </span>
              )}
            </fieldset>
          )}
        </div>
      )}

      {(isEditing || step === 1) && (
        <div className="form-section request-timing">
          {isEditing && (
            <div className="form-section-heading">
              <CalendarClock size={16} aria-hidden="true" />
              <h3>When you need it</h3>
            </div>
          )}
          <Field
            label="Completion date and time"
            controlId="dueAt"
            required
            error={fieldErrors.dueAt}
          >
            <span className="datetime-wrap">
              <input
                className="portal-input"
                id="dueAt"
                name="dueAt"
                type="datetime-local"
                required
                value={form.dueAt}
                aria-invalid={fieldErrors.dueAt ? "true" : undefined}
                aria-describedby={fieldDescribedBy("dueAt", fieldErrors.dueAt)}
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
        </div>
      )}

      {!isEditing && step === 2 && (
        <section className="request-review" aria-label="Request review">
          <dl className="review-list">
            <div>
              <dt>Ministry</dt>
              <dd>{form.ministry}</dd>
            </div>
            <div>
              <dt>Request type</dt>
              <dd>{selectedService?.name ?? form.service}</dd>
            </div>
            <div>
              <dt>Request title</dt>
              <dd>{form.title}</dd>
            </div>
            <div>
              <dt>Detailed instructions</dt>
              <dd>{form.instructions}</dd>
            </div>
            <div>
              <dt>Additional notes</dt>
              <dd>{form.notes}</dd>
            </div>
            {!!form.airedDates?.filter(Boolean).length && (
              <div>
                <dt>Exact aired dates</dt>
                <dd>{form.airedDates.filter(Boolean).join(", ")}</dd>
              </div>
            )}
            <div>
              <dt>Completion date and time</dt>
              <dd>{prettyDate(form.dueAt)}</dd>
            </div>
          </dl>
        </section>
      )}

      {isEditing && (
        <p className="file-share-note">
          Have files? Share them in your ministry’s Telegram group.
        </p>
      )}
      <div className="form-footer">
        {(isEditing || step === 1) && (
          <span>
            <b aria-hidden="true">*</b> Required fields
          </span>
        )}
        <div className="form-actions">
          {isEditing && (
            <button
              className="button button-secondary button-lg"
              type="button"
              onClick={onCancel}
              disabled={busy}
            >
              Revert changes
            </button>
          )}
          <button
            className="button button-primary button-lg"
            type="submit"
            disabled={busy || (!isEditing && !canSubmit)}
          >
            {busy
              ? isEditing
                ? "Saving…"
                : "Sending…"
              : isEditing
                ? "Save changes"
                : step === 2
                  ? "Send request"
                  : "Next"}
            {!busy && <ArrowRight size={17} />}
          </button>
        </div>
      </div>
    </form>
  );
}

function serviceLabel(id: string, services: Service[]) {
  return (
    services.find((service) => service.id === id)?.name ??
    id.replaceAll("-", " ")
  );
}

function departmentLabel(id: string, departments: Catalog["departments"]) {
  return (
    departments.find((department) => department.id === id)?.name ??
    id.replaceAll("-", " ")
  );
}

function TrackingSummary({
  result,
  services,
  departments,
}: {
  result: PublicTracking;
  services: Service[];
  departments: Catalog["departments"];
}) {
  const { request, task } = result;
  const pending = request.status === "pending";
  const rejected = request.status === "rejected";
  const approved = request.status === "approved";
  const taskCompleted = task?.status === "completed";
  const progress = task?.progress ?? 0;
  const department = task ? departmentLabel(task.department, departments) : "";

  let statusClass = "status-pending";
  let statusLabel = "Awaiting review";
  if (rejected) {
    statusClass = "status-rejected";
    statusLabel = "Not approved";
  } else if (approved && taskCompleted) {
    statusClass = "status-completed";
    statusLabel = "Completed";
  } else if (approved && task?.status === "in-progress") {
    statusClass = "status-approved";
    statusLabel = "In progress";
  } else if (approved) {
    statusClass = "status-approved";
    statusLabel = "Approved";
  }

  return (
    <section className="tracking-summary">
      <div className="tracking-summary-top">
        <div>
          <h3>{request.title}</h3>
        </div>
        <span className={`status-badge ${statusClass}`}>{statusLabel}</span>
      </div>
      <div className="tracking-meta">
        <span>{request.ministry}</span>
        <span>{serviceLabel(request.service, services)}</span>
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
            data-complete={taskCompleted ? "true" : undefined}
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

function RequestDetails({
  request,
  services,
}: {
  request: PublicRequest;
  services: Service[];
}) {
  return (
    <dl className="request-details">
      <div>
        <dt>Ministry</dt>
        <dd>{request.ministry}</dd>
      </div>
      <div>
        <dt>Request type</dt>
        <dd>{serviceLabel(request.service, services)}</dd>
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
