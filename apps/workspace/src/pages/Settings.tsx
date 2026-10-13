import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Check,
  KeyRound,
  LockKeyhole,
  LogOut,
  Mail,
  ShieldCheck,
  ToggleLeft,
  ToggleRight,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { Badge, Button, Field } from "@moc/ui";
import { DEPARTMENTS, type Department, type Leader } from "@moc/shared";
import { api, useWorkspace } from "@moc/client";
import "./workflows.css";

const allowedRanks: Record<Department, Leader["rank"][]> = {
  "cell-0": ["BJN", "CMN", "SMN"],
  sound: ["GJN", "TJN"],
  design: ["GJN", "TJN"],
  "visual-media": ["GJN", "TJN"],
};
const rankLabels: Record<Leader["rank"], string> = {
  BJN: "BJN · Cell 0 lead",
  CMN: "CMN · Cell 0 ministry lead",
  SMN: "SMN · Cell 0 support",
  GJN: "GJN · Department lead",
  TJN: "TJN · Department support",
};

export default function SettingsPage() {
  const { state, user, demo, loading, error, act, switchDepartment, logout } =
    useWorkspace();
  const integrations = useQuery({
    queryKey: ["integrations"],
    queryFn: () =>
      api<{
        telegramConfigured: boolean;
        googleConfigured: boolean;
        storage: string;
      }>("/api/integrations"),
    enabled: Boolean(user?.approved && user.department === "cell-0" && !demo),
    staleTime: 60_000,
  });
  const [tab, setTab] = useState<"access" | "integrations">("access");
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [form, setForm] = useState({
    name: "",
    email: "",
    department: "sound" as Department,
    rank: "GJN" as Leader["rank"],
  });
  const isCell0 = user?.approved && user.department === "cell-0";
  const users = state?.users ?? [];
  const teams = DEPARTMENTS.filter((department) => department.id !== "cell-0");
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setFeedback("");
    try {
      await operation();
    } catch (cause) {
      setFeedback(
        cause instanceof Error
          ? cause.message
          : "The change could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };
  const addUser = (event: React.FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await act({
        type: "add-user",
        input: {
          name: form.name,
          email: form.email,
          department: form.department,
          rank: form.rank,
          approved: false,
        },
      });
      setFormOpen(false);
      setForm({ name: "", email: "", department: "sound", rank: "GJN" });
    });
  };
  const changeDepartment = (department: Department) => {
    if (demo) void run(() => switchDepartment(department));
  };
  const changeAccess = (person: Leader, approved: boolean) =>
    void run(() => act({ type: "update-user", userId: person.id, approved }));
  const updateDepartment = (department: Department) =>
    setForm((current) => ({
      ...current,
      department,
      rank: allowedRanks[department][0],
    }));

  if (loading)
    return (
      <div className="workspace-page">
        <div className="workflow-skeleton" />
      </div>
    );
  if (!user?.approved)
    return (
      <div className="workspace-page">
        <section className="workflow-empty">
          <LockKeyhole />
          <h2>Account access required</h2>
          <p>
            Sign in with an approved leader account to view workspace settings.
          </p>
        </section>
      </div>
    );

  return (
    <div className="workspace-page workflow-page">
      <div className="page-header workflow-header">
        <div>
          <div className="eyebrow">Workspace / Administration</div>
          <div className="page-heading">
            <div>
              <h1>Settings</h1>
              <p>Manage approved leaders, sign-in and connected services.</p>
            </div>
            <Badge tone={demo ? "gold" : "green"}>
              {demo ? "Demo workspace" : "Live workspace"}
            </Badge>
          </div>
        </div>
        <Button
          onClick={() =>
            void run(async () => {
              await logout();
            })
          }
        >
          <LogOut size={16} /> Sign out
        </Button>
      </div>
      <div
        className="settings-tabs"
        role="tablist"
        aria-label="Settings sections"
      >
        <button
          role="tab"
          aria-selected={tab === "access"}
          className={tab === "access" ? "settings-tab active" : "settings-tab"}
          onClick={() => setTab("access")}
        >
          <Users size={16} /> Access & roles
        </button>
        <button
          role="tab"
          aria-selected={tab === "integrations"}
          className={
            tab === "integrations" ? "settings-tab active" : "settings-tab"
          }
          onClick={() => setTab("integrations")}
        >
          <ToggleRight size={16} /> Integrations
        </button>
      </div>
      {(error || feedback) && (
        <div className="workflow-alert" role="alert">
          <span>{feedback || error}</span>
          <button aria-label="Dismiss" onClick={() => setFeedback("")}>
            <X size={15} />
          </button>
        </div>
      )}
      {tab === "access" && (
        <div className="settings-content">
          {isCell0 ? (
            <>
              <section className="settings-card">
                <div className="settings-card-heading">
                  <div>
                    <div className="settings-icon">
                      <Users size={18} />
                    </div>
                    <h2>Leader access</h2>
                    <p>
                      Only listed leaders whose access is approved can enter the
                      workspace.
                    </p>
                  </div>
                  <Button
                    variant="primary"
                    onClick={() => {
                      setFeedback("");
                      setFormOpen((value) => !value);
                    }}
                  >
                    <UserPlus size={16} /> Add leader
                  </Button>
                </div>
                <div className="access-guide">
                  <span>
                    <strong>Cell 0</strong> BJN, CMN, SMN
                  </span>
                  <span>
                    <strong>Production departments</strong> GJN, TJN
                  </span>
                </div>
                {formOpen && (
                  <form className="leader-form" onSubmit={addUser}>
                    <div className="leader-form-heading">
                      <div>
                        <h3>Add a leader</h3>
                        <p>
                          They’ll sign in with the email address you approve.
                        </p>
                      </div>
                      <button
                        type="button"
                        className="icon-button quiet"
                        aria-label="Close form"
                        onClick={() => setFormOpen(false)}
                      >
                        <X size={17} />
                      </button>
                    </div>
                    <div className="form-row">
                      <Field label="Full name">
                        <input
                          required
                          maxLength={120}
                          value={form.name}
                          onChange={(event) =>
                            setForm({ ...form, name: event.target.value })
                          }
                          placeholder="Leader name"
                        />
                      </Field>
                      <Field label="Approved email">
                        <input
                          type="email"
                          required
                          maxLength={254}
                          value={form.email}
                          onChange={(event) =>
                            setForm({ ...form, email: event.target.value })
                          }
                          placeholder="name@example.org"
                        />
                      </Field>
                    </div>
                    <div className="form-row">
                      <Field label="Department">
                        <select
                          value={form.department}
                          onChange={(event) =>
                            updateDepartment(event.target.value as Department)
                          }
                        >
                          {DEPARTMENTS.map((department) => (
                            <option value={department.id} key={department.id}>
                              {department.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Rank">
                        <select
                          value={form.rank}
                          onChange={(event) =>
                            setForm({
                              ...form,
                              rank: event.target.value as Leader["rank"],
                            })
                          }
                        >
                          {allowedRanks[form.department].map((rank) => (
                            <option value={rank} key={rank}>
                              {rankLabels[rank]}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    <div className="form-actions">
                      <Button type="button" onClick={() => setFormOpen(false)}>
                        Cancel
                      </Button>
                      <Button variant="primary" type="submit" disabled={busy}>
                        {busy ? "Saving…" : "Add pending leader"}
                      </Button>
                    </div>
                  </form>
                )}
                <div className="leader-list">
                  {users.map((person) => (
                    <div className="leader-row" key={person.id}>
                      <div className="leader-avatar">
                        {person.name
                          .split(" ")
                          .map((part) => part[0])
                          .join("")
                          .slice(0, 2)
                          .toUpperCase()}
                      </div>
                      <div className="leader-identity">
                        <strong>{person.name}</strong>
                        <span>
                          <Mail size={13} /> {person.email}
                        </span>
                      </div>
                      <div className="leader-role">
                        <strong>
                          {
                            DEPARTMENTS.find(
                              (department) =>
                                department.id === person.department,
                            )?.name
                          }
                        </strong>
                        <span>{person.rank}</span>
                      </div>
                      <Badge tone={person.approved ? "green" : "gold"}>
                        {person.approved ? "Approved" : "Pending"}
                      </Badge>
                      {person.id === user.id ? (
                        <Badge> You </Badge>
                      ) : person.approved ? (
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={busy}
                          onClick={() => changeAccess(person, false)}
                        >
                          Revoke
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={busy}
                          onClick={() => changeAccess(person, true)}
                        >
                          <Check size={14} /> Approve
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
              {demo && (
                <section className="settings-card demo-role-card">
                  <div className="settings-card-heading">
                    <div>
                      <div className="settings-icon gold">
                        <KeyRound size={18} />
                      </div>
                      <h2>Demo role switcher</h2>
                      <p>
                        Preview the workspace as any seeded department persona.
                        Changes are clearly marked as demo.
                      </p>
                    </div>
                    <Badge tone="gold">Demo only</Badge>
                  </div>
                  <div className="demo-role-options">
                    {DEPARTMENTS.map((department) => (
                      <button
                        key={department.id}
                        className={
                          user.department === department.id
                            ? "demo-role-option active"
                            : "demo-role-option"
                        }
                        onClick={() => changeDepartment(department.id)}
                        disabled={busy}
                      >
                        <span>{department.name}</span>
                        <small>
                          {department.id === "cell-0" ? "BJN" : "GJN"} ·{" "}
                          {user.department === department.id
                            ? "Current role"
                            : "Switch role"}
                        </small>
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </>
          ) : (
            <>
              <section className="settings-card account-summary">
                <div className="settings-icon">
                  <ShieldCheck size={18} />
                </div>
                <div>
                  <h2>Your account</h2>
                  <p>{user.name}</p>
                  <span>{user.email}</span>
                </div>
                <Badge tone="green">Approved</Badge>
                <div className="account-role">
                  <span>Department</span>
                  <strong>
                    {
                      DEPARTMENTS.find(
                        (department) => department.id === user.department,
                      )?.name
                    }
                  </strong>
                </div>
                <div className="account-role">
                  <span>Role</span>
                  <strong>{user.rank}</strong>
                </div>
              </section>
              {demo && (
                <section className="settings-card demo-role-card">
                  <div className="settings-card-heading">
                    <div>
                      <div className="settings-icon gold">
                        <KeyRound size={18} />
                      </div>
                      <h2>Demo role switcher</h2>
                      <p>
                        Preview the workspace as any seeded department persona.
                        Changes are clearly marked as demo.
                      </p>
                    </div>
                    <Badge tone="gold">Demo only</Badge>
                  </div>
                  <div className="demo-role-options">
                    {DEPARTMENTS.map((department) => (
                      <button
                        key={department.id}
                        className={
                          user.department === department.id
                            ? "demo-role-option active"
                            : "demo-role-option"
                        }
                        onClick={() => changeDepartment(department.id)}
                        disabled={busy}
                      >
                        <span>{department.name}</span>
                        <small>
                          {department.id === "cell-0" ? "BJN" : "GJN"} ·{" "}
                          {user.department === department.id
                            ? "Current role"
                            : "Switch role"}
                        </small>
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      )}
      {tab === "integrations" && (
        <section className="settings-card integrations-card">
          <div className="settings-card-heading">
            <div>
              <div className="settings-icon">
                <ToggleLeft size={18} />
              </div>
              <h2>Connected services</h2>
              <p>Connection state comes from the workspace API.</p>
            </div>
          </div>
          <div className="integration-row">
            <div className="integration-brand">
              <span className="telegram-mark">➤</span>
              <div>
                <strong>Telegram notifications</strong>
                <small>
                  Send selected workspace updates to a Telegram channel.
                </small>
              </div>
            </div>
            <Badge
              tone={
                !isCell0 || demo || integrations.isError
                  ? "neutral"
                  : integrations.data?.telegramConfigured
                    ? "green"
                    : "neutral"
              }
            >
              {!isCell0
                ? "Managed by Cell 0"
                : demo
                  ? "Demo status unavailable"
                  : integrations.isPending
                    ? "Checking…"
                    : integrations.isError
                      ? "Status unavailable"
                      : integrations.data?.telegramConfigured
                        ? "Configured"
                        : "Not configured"}
            </Badge>
          </div>
          <div className="integration-note">
            <LockKeyhole size={15} />
            <p>
              {!isCell0
                ? "Only Cell 0 can view integration status."
                : demo
                  ? "Integration credentials are not exposed in demo mode."
                  : integrations.isError
                    ? integrations.error.message
                    : integrations.isPending
                      ? "Checking the API for current integration status."
                      : integrations.data?.telegramConfigured
                        ? "Telegram is configured on the workspace API. Notification delivery is managed by the server."
                        : "Telegram is not configured on the workspace API. No messages can be sent."}
            </p>
          </div>
          <div className="integration-meta">
            <span>Sign-in provider</span>
            <strong>
              {!isCell0
                ? "Managed by Cell 0"
                : demo
                  ? "Demo persona"
                  : integrations.isPending
                    ? "Checking…"
                    : integrations.data?.googleConfigured
                      ? "Google OAuth configured"
                      : "Google OAuth unavailable"}
            </strong>
            <span>Data access</span>
            <strong>Workspace API</strong>
            <span>Storage</span>
            <strong>
              {!isCell0
                ? "Managed by Cell 0"
                : demo
                  ? "Demo workspace"
                  : (integrations.data?.storage ??
                    (integrations.isPending
                      ? "Checking…"
                      : "Status unavailable"))}
            </strong>
          </div>
        </section>
      )}
    </div>
  );
}
