import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Clipboard,
  LockKeyhole,
  Mail,
  RefreshCw,
  UserPlus,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  Field,
  InlineEditCell,
  SegmentedControl,
} from "@moc/ui";
import type { Department, Member, SubTeam } from "@moc/shared";
import { useWorkspace } from "@moc/client";
import { DepartmentManagement } from "../DepartmentManagement";
import "./workflows.css";
import "./members.css";

type MemberForm = Pick<
  Member,
  "name" | "email" | "duty" | "department" | "groups" | "isLeader"
>;

const blankForm: MemberForm = {
  name: "",
  email: "",
  duty: "",
  department: "",
  groups: [],
  isLeader: false,
};

function departmentName(
  id: string,
  departments: { id: string; name: string }[],
) {
  return departments.find((department) => department.id === id)?.name ?? id;
}

export default function SettingsPage() {
  const { state, user, loading, act } = useWorkspace();
  const [section, setSection] = useState<"members" | "departments">(
    window.location.hash === "#departments" ? "departments" : "members",
  );
  const [tableOverflow, setTableOverflow] = useState(false);
  const [tableWrapElement, setTableWrapElement] = useState<HTMLDivElement | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState<MemberForm>(blankForm);
  const [busyKey, setBusyKey] = useState("");
  const [feedback, setFeedback] = useState("");
  const [retryOperation, setRetryOperation] = useState<(() => Promise<void>) | null>(null);
  const [inviteLink, setInviteLink] = useState("");
  const [invitedEmail, setInvitedEmail] = useState("");
  const [copyFeedback, setCopyFeedback] = useState("");
  const departments = state?.catalog?.departments ?? [];
  const members = state?.users ?? [];
  const canManage = Boolean(
    user?.approved && user.isLeader && user.department === "cell-0",
  );
  const isCurrentMember = (member: Member) => member.id === user?.id;
  const isProtectedAdmin = (member: Member) =>
    isCurrentMember(member) && member.isLeader && member.department === "cell-0";
  const sortedMembers = useMemo(
    () =>
      members
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, "en-ZA")),
    [members],
  );

  useEffect(() => {
    const syncSectionFromHash = () => {
      const next = window.location.hash === "#departments" ? "departments" : "members";
      setSection(next);
      requestAnimationFrame(() =>
        document.getElementById(next)?.scrollIntoView({ block: "start" }),
      );
    };
    window.addEventListener("hashchange", syncSectionFromHash);
    if (window.location.hash === "#members" || window.location.hash === "#departments") {
      syncSectionFromHash();
    }
    return () => window.removeEventListener("hashchange", syncSectionFromHash);
  }, []);

  useEffect(() => {
    const wrapper = tableWrapElement;
    if (section !== "members" || !wrapper) {
      setTableOverflow(false);
      return;
    }

    const updateOverflow = () =>
      setTableOverflow(wrapper.scrollWidth > wrapper.clientWidth + 1);
    updateOverflow();
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(wrapper);
    if (wrapper.firstElementChild) observer.observe(wrapper.firstElementChild);
    return () => observer.disconnect();
  }, [section, tableWrapElement, sortedMembers.length, inviteOpen, inviteLink]);

  const run = async (
    key: string,
    operation: () => Promise<void>,
    onSuccess?: () => void,
  ) => {
    setBusyKey(key);
    setFeedback("");
    try {
      await operation();
      setRetryOperation(null);
      onSuccess?.();
      return true;
    } catch (cause) {
      setRetryOperation(() => async () => {
        await operation();
        onSuccess?.();
      });
      setFeedback(
        cause instanceof Error ? cause.message : "The change could not be saved.",
      );
      return false;
    } finally {
      setBusyKey("");
    }
  };

  const initialForm = (): MemberForm => {
    const department =
      departments.find((item) => item.id !== "cell-0") ?? departments[0];
    return {
      ...blankForm,
      department: department?.id ?? "",
      groups: department?.groups.slice(0, 1) ?? [],
    };
  };

  const chooseDepartment = (
    form: MemberForm,
    update: (next: MemberForm) => void,
    departmentId: Department,
  ) => {
    const nextDepartment = departments.find(
      (department) => department.id === departmentId,
    );
    update({
      ...form,
      department: departmentId,
      groups: nextDepartment?.groups.slice(0, 1) ?? [],
    });
  };

  const toggleGroup = (
    form: MemberForm,
    update: (next: MemberForm) => void,
    group: SubTeam,
    checked: boolean,
  ) =>
    update({
      ...form,
      groups: checked
        ? [...new Set([...form.groups, group])]
        : form.groups.filter((item) => item !== group),
    });

  const inviteMember = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!inviteForm.groups.length) {
      setFeedback("Choose at least one group for this member.");
      return;
    }
    await run(
      "invite",
      async () => {
        await act({
          type: "invite-member",
          input: {
            ...inviteForm,
            name: inviteForm.name.trim(),
            email: inviteForm.email.trim(),
            duty: inviteForm.duty.trim(),
          },
        });
      },
      () => {
        setInviteLink(`${window.location.origin}/login`);
        setInvitedEmail(inviteForm.email.trim());
        setCopyFeedback("");
        setInviteOpen(false);
        setInviteForm(initialForm());
        setFeedback("Member invited. Their sign-in link is ready to share.");
      },
    );
  };

  const saveMemberCell = async (
    member: Member,
    changes: Partial<Omit<MemberForm, "email">>,
    field: string,
  ) => {
    const key = `member-${member.id}-${field}`;
    setBusyKey(key);
    try {
      await act({ type: "update-member", userId: member.id, changes });
    } finally {
      setBusyKey("");
    }
  };

  const changeMemberAccess = (member: Member, approved: boolean) =>
    void run(`access-${member.id}`, async () => {
      await act({
        type: "update-member",
        userId: member.id,
        changes: { approved },
      });
    });

  const changeLeaderRole = (member: Member, isLeader: boolean) =>
    void run(`role-${member.id}`, async () => {
      await act({
        type: "update-member",
        userId: member.id,
        changes: { isLeader },
      });
    });

  const copyLink = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopyFeedback("Sign-in link copied.");
    } catch {
      setCopyFeedback("Copy was unavailable. Select the link above to copy it.");
    }
  };

  const retryLastAction = () => {
    const operation = retryOperation;
    if (operation) void run("retry", operation);
  };

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
            Sign in with an approved member account to view workspace settings.
          </p>
        </section>
      </div>
    );

  return (
    <div className="workspace-page workflow-page members-settings-page">
      <div className="page-header workflow-header">
        <div className="page-heading">
          <div>
            <h1>Settings</h1>
          </div>
        </div>
      </div>

      {feedback && (
        <div className="workflow-alert members-feedback" role="alert">
          <span>{feedback}</span>
          {retryOperation && (
            <Button
              size="sm"
              variant="secondary"
              disabled={Boolean(busyKey)}
              onClick={retryLastAction}
            >
              <RefreshCw size={14} />
              {busyKey === "retry" ? "Retrying…" : "Retry"}
            </Button>
          )}
          <button
            type="button"
            aria-label="Dismiss message"
            onClick={() => setFeedback("")}
          >
            <X size={15} />
          </button>
        </div>
      )}

      {canManage ? (
        <>
          <div className="w-fit max-w-full">
            <SegmentedControl
              label="Settings section"
              value={section}
              onValueChange={(value) => {
                if (value !== "members" && value !== "departments") return;
                window.location.hash = value;
                setSection(value);
              }}
              options={[
                { value: "members", label: "Members" },
                { value: "departments", label: "Departments" },
              ]}
            />
          </div>

          {section === "members" ? (
          <section
            className="members-section"
            id="members"
            aria-labelledby="members-heading"
          >
            <div className="members-section-heading">
              <h2 id="members-heading">Members</h2>
              <Button
                variant="primary"
                onClick={() => {
                  setFeedback("");
                  setInviteForm(initialForm());
                  setInviteOpen((open) => !open);
                }}
              >
                <UserPlus size={16} /> {inviteOpen ? "Close invite" : "Invite member"}
              </Button>
            </div>

            {inviteLink && (
              <aside className="members-invite-ready" aria-live="polite">
                <div className="members-invite-ready-copy">
                  <Check size={17} aria-hidden="true" />
                  <div>
                    <strong>Invitation ready to share</strong>
                    <p>
                      Share this workspace sign-in link with {invitedEmail || "the invited member"}. Google must verify the invited email address. No email was sent.
                    </p>
                  </div>
                </div>
                <div className="members-invite-link-row">
                  <input
                    aria-label="Workspace sign-in link"
                    readOnly
                    value={inviteLink}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <Button size="sm" variant="secondary" onClick={() => void copyLink()}>
                    <Clipboard size={14} /> Copy link
                  </Button>
                </div>
                {copyFeedback && <span className="members-copy-feedback">{copyFeedback}</span>}
              </aside>
            )}

            {inviteOpen && (
              <form className="members-form" onSubmit={inviteMember}>
                <div className="members-form-heading">
                  <div>
                    <h3>Invite a member</h3>
                    <p>The invitation is bound to the email address they verify.</p>
                  </div>
                  <button
                    type="button"
                    className="members-icon-button"
                    aria-label="Close invite form"
                    onClick={() => setInviteOpen(false)}
                  >
                    <X size={17} />
                  </button>
                </div>
                <div className="members-form-grid">
                  <Field label="Full name">
                    <input
                      required
                      maxLength={120}
                      autoComplete="name"
                      value={inviteForm.name}
                      onChange={(event) =>
                        setInviteForm({ ...inviteForm, name: event.target.value })
                      }
                      placeholder="Member name"
                    />
                  </Field>
                  <Field label="Email address">
                    <input
                      required
                      type="email"
                      maxLength={254}
                      autoComplete="email"
                      value={inviteForm.email}
                      onChange={(event) =>
                        setInviteForm({ ...inviteForm, email: event.target.value })
                      }
                      placeholder="name@example.org"
                    />
                  </Field>
                  <Field label="Duty">
                    <input
                      required
                      maxLength={120}
                      value={inviteForm.duty}
                      onChange={(event) =>
                        setInviteForm({ ...inviteForm, duty: event.target.value })
                      }
                      placeholder="For example, Sound operator"
                    />
                  </Field>
                  <Field label="Department">
                    <select
                      required
                      value={inviteForm.department}
                      onChange={(event) =>
                        chooseDepartment(
                          inviteForm,
                          setInviteForm,
                          event.target.value,
                        )
                      }
                    >
                      <option value="" disabled>
                        Choose a department
                      </option>
                      {departments.map((department) => (
                        <option value={department.id} key={department.id}>
                          {department.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <GroupPicker
                  departments={departments}
                  form={inviteForm}
                  onToggle={(group, checked) =>
                    toggleGroup(inviteForm, setInviteForm, group, checked)
                  }
                />
                <LeaderSwitch
                  checked={inviteForm.isLeader}
                  disabled={false}
                  name="Invite member as a leader"
                  onChange={(checked) =>
                    setInviteForm({ ...inviteForm, isLeader: checked })
                  }
                  help="Leaders can manage request options. Workspace access is controlled separately."
                />
                <div className="members-form-actions">
                  <Button type="button" onClick={() => setInviteOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    type="submit"
                    disabled={busyKey === "invite" || departments.length === 0}
                  >
                    <UserPlus size={15} />
                    {busyKey === "invite" ? "Inviting…" : "Invite member"}
                  </Button>
                </div>
              </form>
            )}

            <div
              ref={setTableWrapElement}
              className="members-table-wrap"
              role="region"
              aria-label="Members table; scroll horizontally to see all columns"
              tabIndex={0}
            >
              {tableOverflow && <div className="members-table-scroll-cue" aria-hidden="true">Scroll horizontally to see all member fields →</div>}
              <p className="members-email-note">Email addresses are linked to member sign-in and cannot be changed after invitation.</p>
              <table className="members-table">
                <colgroup>
                  <col className="members-col-member" />
                  <col className="members-col-email" />
                  <col className="members-col-duty" />
                  <col className="members-col-department" />
                  <col className="members-col-groups" />
                  <col className="members-col-role" />
                  <col className="members-col-access" />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">Member</th>
                    <th scope="col">Email</th>
                    <th scope="col">Duty</th>
                    <th scope="col">Department</th>
                    <th scope="col">Groups</th>
                    <th scope="col">Leader</th>
                    <th scope="col">Access</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedMembers.map((member) => {
                    const protectedAdmin = isProtectedAdmin(member);
                    const memberBusy = busyKey.startsWith(`member-${member.id}-`);
                    const groupOptions = departments.find((item) => item.id === member.department)?.groups ?? [];
                    const selectedGroups = member.groups.filter((group) => groupOptions.includes(group));
                    return (
                      <tr className="members-row" key={member.id}>
                          <th scope="row" data-label="Member">
                            <div className="members-identity">
                              <InlineEditCell
                                label={`${member.name} name`}
                                value={member.name}
                                displayValue={<strong>{member.name}{isCurrentMember(member) && <span className="members-you">You</span>}</strong>}
                                disabled={Boolean(busyKey) || memberBusy}
                                validate={(value) => value.trim() ? undefined : "Enter a member name."}
                                onSave={(value) => saveMemberCell(member, { name: value.trim() }, "name")}
                                renderEditor={({ value, onChange, disabled }) => <input aria-label={`Name for ${member.name}`} value={value} maxLength={120} disabled={disabled} onChange={(event) => onChange(event.target.value)} />}
                              />
                            </div>
                          </th>
                          <td data-label="Email"><span className="members-email"><Mail size={13} aria-hidden="true" />{member.email}</span></td>
                          <td data-label="Duty">
                            <InlineEditCell
                              label={`${member.name} duty`}
                              value={member.duty}
                              displayValue={member.duty || "Not set"}
                              disabled={Boolean(busyKey) || memberBusy}
                              validate={(value) => value.trim() ? undefined : "Enter a duty."}
                              onSave={(value) => saveMemberCell(member, { duty: value.trim() }, "duty")}
                              renderEditor={({ value, onChange, disabled }) => <input aria-label={`Duty for ${member.name}`} value={value} maxLength={120} disabled={disabled} onChange={(event) => onChange(event.target.value)} />}
                            />
                          </td>
                          <td data-label="Department">
                            <InlineEditCell
                              label={`${member.name} department`}
                              value={member.department}
                              displayValue={departmentName(member.department, departments)}
                              disabled={Boolean(busyKey) || memberBusy || protectedAdmin}
                              onSave={(departmentId) => {
                                const nextDepartment = departments.find((item) => item.id === departmentId);
                                if (!nextDepartment) return Promise.reject(new Error("Choose a valid department."));
                                const validGroups = member.groups.filter((group) => nextDepartment.groups.includes(group));
                                return saveMemberCell(member, {
                                  department: nextDepartment.id,
                                  groups: validGroups.length ? validGroups : nextDepartment.groups.slice(0, 1),
                                }, "department");
                              }}
                              renderEditor={({ value, onChange, disabled }) => {
                                const nextDepartment = departments.find((item) => item.id === value);
                                const matchingGroups = nextDepartment
                                  ? member.groups.filter((group) => nextDepartment.groups.includes(group))
                                  : [];
                                const resultingGroups = matchingGroups.length
                                  ? matchingGroups
                                  : nextDepartment?.groups.slice(0, 1) ?? [];
                                return (
                                  <>
                                    <select aria-label={`Department for ${member.name}`} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
                                      {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                                    </select>
                                    <small className="members-department-group-preview">
                                      Groups will be set to {resultingGroups.join(", ") || "none"}.
                                    </small>
                                  </>
                                );
                              }}
                            />
                          </td>
                          <td data-label="Groups">
                            <InlineEditCell
                              label={`${member.name} groups`}
                              value={selectedGroups}
                              displayValue={selectedGroups.length ? <div className="members-groups">{selectedGroups.map((group) => <span key={group}>{group}</span>)}</div> : "Not assigned"}
                              disabled={Boolean(busyKey) || memberBusy || protectedAdmin}
                              validate={(value) => value.length ? undefined : "Choose at least one group."}
                              onSave={(groups) => saveMemberCell(member, { groups }, "groups")}
                              renderEditor={({ value, onChange, disabled }) => (
                                <div className="members-inline-group-options" role="group" aria-label={`Groups for ${member.name}`}>
                                  {groupOptions.map((group) => {
                                    const checked = value.includes(group);
                                    return <label key={group}><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked ? [...value, group] : value.filter((item) => item !== group))} />{group}</label>;
                                  })}
                                </div>
                              )}
                            />
                          </td>
                          <td data-label="Leader">
                            <LeaderSwitch
                              checked={member.isLeader}
                              disabled={Boolean(busyKey) || protectedAdmin || memberBusy}
                              name={`${member.name} leader role`}
                              compact
                              onChange={(checked) => changeLeaderRole(member, checked)}
                            />
                          </td>
                          <td data-label="Access">
                            <LeaderSwitch
                              checked={member.approved}
                              disabled={Boolean(busyKey) || isCurrentMember(member) || memberBusy}
                              name={`${member.name} workspace access`}
                              compact
                              onChange={(checked) => changeMemberAccess(member, checked)}
                            />
                          </td>
                        </tr>
                    );
                  })}
                  {sortedMembers.length === 0 && (
                    <tr><td className="members-empty" colSpan={7}>No members yet. Invite the first member to get started.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
          ) : (
          <section
            className="members-section department-management-section"
            id="departments"
            aria-label="Departments and groups"
          >
            <DepartmentManagement />
          </section>
          )}
        </>
      ) : (
        <section className="members-section account-members-summary" aria-labelledby="account-heading">
          <div className="members-section-heading">
            <div>
              <div>
                <h2 id="account-heading">Your account</h2>
                <p>{user.name}</p>
              </div>
            </div>
            <Badge tone={user.approved ? "green" : "gold"}>
              {user.approved ? "Approved access" : "Access paused"}
            </Badge>
          </div>
          <dl className="members-account-details">
            <div><dt>Email</dt><dd>{user.email}</dd></div>
            <div><dt>Duty</dt><dd>{user.duty || "Not set"}</dd></div>
            <div><dt>Department</dt><dd>{departmentName(user.department, departments)}</dd></div>
            <div><dt>Groups</dt><dd>{user.groups?.join(", ") || "Not assigned"}</dd></div>
            <div><dt>Role</dt><dd>{user.isLeader ? "Leader" : "Member"}</dd></div>
          </dl>
        </section>
      )}
    </div>
  );
}

function GroupPicker({
  departments,
  form,
  onToggle,
}: {
  departments: { id: string; groups: string[] }[];
  form: MemberForm;
  onToggle: (group: string, checked: boolean) => void;
}) {
  const groups = departments.find((department) => department.id === form.department)?.groups ?? [];
  return (
    <fieldset className="members-groups-fieldset">
      <legend>Groups</legend>
      <div className="members-group-options">
        {groups.map((group) => (
          <label key={group} className="members-group-option">
            <input
              type="checkbox"
              checked={form.groups.includes(group)}
              onChange={(event) => onToggle(group, event.target.checked)}
            />
            <span>{group}</span>
          </label>
        ))}
        {groups.length === 0 && <span className="members-helper">Choose a department to see its groups.</span>}
      </div>
    </fieldset>
  );
}

function LeaderSwitch({
  checked,
  disabled,
  name,
  onChange,
  help,
  compact = false,
}: {
  checked: boolean;
  disabled: boolean;
  name: string;
  onChange: (checked: boolean) => void;
  help?: string;
  compact?: boolean;
}) {
  return (
    <label className={compact ? "member-switch compact" : "member-switch"}>
      {!compact && <span className="member-switch-copy"><strong>{name}</strong>{help && <small>{help}</small>}</span>}
      <input
        type="checkbox"
        role="switch"
        aria-label={name}
        aria-checked={checked}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="member-switch-track" aria-hidden="true" />
      {compact && <span className="member-switch-state">{checked ? "On" : "Off"}</span>}
    </label>
  );
}
