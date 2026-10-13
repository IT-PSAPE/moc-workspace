import { useState } from "react";
import {
  Check,
  LockKeyhole,
  LogOut,
  Mail,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { Badge, Button, Field } from "@moc/ui";
import { DEPARTMENTS, type Department, type Leader } from "@moc/shared";
import { useWorkspace } from "@moc/client";
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
  const { state, user, loading, error, act, logout } = useWorkspace();
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
          <div className="page-heading">
            <div>
              <h1>Settings</h1>
              <p>Manage leader access and your account.</p>
            </div>
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
      {(error || feedback) && (
        <div className="workflow-alert" role="alert">
          <span>{feedback || error}</span>
          <button aria-label="Dismiss" onClick={() => setFeedback("")}>
            <X size={15} />
          </button>
        </div>
      )}
      <div className="settings-content">
        {isCell0 ? (
          <section className="settings-card">
            <div className="settings-card-heading">
              <div>
                <div className="settings-icon">
                  <Users size={18} />
                </div>
                <h2>Leader access</h2>
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
            {formOpen && (
              <form className="leader-form" onSubmit={addUser}>
                <div className="leader-form-heading">
                  <div>
                    <h3>Add a leader</h3>
                    <p>They’ll sign in with the email address you approve.</p>
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
            <div className="leader-table-wrap">
              <table className="leader-table">
                <thead>
                  <tr>
                    <th scope="col">Leader</th>
                    <th scope="col">Department</th>
                    <th scope="col">Rank</th>
                    <th scope="col">Access</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((person) => (
                    <tr key={person.id}>
                      <th scope="row">
                        <div className="leader-identity">
                          <strong>{person.name}</strong>
                          <span>
                            <Mail size={13} /> {person.email}
                          </span>
                        </div>
                      </th>
                      <td>
                        {
                          DEPARTMENTS.find(
                            (department) => department.id === person.department,
                          )?.name
                        }
                      </td>
                      <td>{person.rank}</td>
                      <td>
                        <Badge tone={person.approved ? "green" : "gold"}>
                          {person.approved ? "Approved" : "Pending"}
                        </Badge>
                      </td>
                      <td className="leader-actions">
                        {person.id === user.id ? (
                          <span className="leader-self">You</span>
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <section className="settings-card account-summary">
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
              <span>Rank</span>
              <strong>{user.rank}</strong>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
